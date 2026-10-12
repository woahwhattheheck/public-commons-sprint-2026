// Operate the original SF47 completion workspace and receive its retained case.
// This module is joined to the existing managed Support native operation.
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const execute=promisify(execFile);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const clone=value=>JSON.parse(JSON.stringify(value));
const RULE_URL='https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines';
const DATES={
  calendarStart:'2027-12-01',
  payments:[
    {tranche:0,paidOn:'2027-12-01',amount:'3800',deadlineOn:'2028-02-29'},
    {tranche:1,paidOn:'2028-01-31',amount:'7600',deadlineOn:'2028-04-30'},
    {tranche:2,paidOn:'2028-03-31',amount:'11400',deadlineOn:'2028-06-29'},
    {tranche:3,paidOn:'2028-07-31',amount:'15200',deadlineOn:null}
  ],
  submissions:[
    {tranche:1,completedOn:'2027-12-31',submittedOn:'2028-01-02',resubmittedOn:'2028-01-06',acceptedOn:'2028-01-08'},
    {tranche:2,completedOn:'2028-02-29',submittedOn:'2028-03-05',acceptedOn:'2028-03-14'},
    {tranche:3,completedOn:'2028-04-29',submittedOn:'2028-07-05',acceptedOn:'2028-07-10'}
  ],
  extension:{tranche:3,confirmedOn:'2028-06-20',deadlineOn:'2028-07-15'}
};
const ACTOR='Native grant completion operator';
const BASIS='Values entered in the original WALKTHROUGH case to operate its grant delivery and reporting workflow.';
async function exists(path){try{await fs.access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function originalFile(path,bytes){
  const raw=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  try{await fs.writeFile(path,raw,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await fs.readFile(path),raw,'retained original input '+path);}
  return{path,bytes:raw.length,sha256:digest(raw)};
}
async function atomicJson(path,value){
  const temporary=path+'.saving-'+randomUUID();
  await fs.writeFile(temporary,json(value),{mode:0o600});await fs.rename(temporary,path);
}
function byReceipt(view,id){const row=view.clocks.find(item=>item.receiptId===id);assert.ok(row,'retained payment clock '+id);return row;}
function completionRows(state){return state.records.outcomes.filter(row=>row.completion);}
function originalSelection(state,owned){
  return {
    mode:state.program.mode,calendarStart:state.program.calendarStart,
    completionPlans:state.completionPlans,
    cash:state.records.cash.filter(row=>owned.paymentIds.includes(row.id)),
    contributors:state.records.contributors.filter(row=>owned.contributorIds.includes(row.id)),
    work:state.records.work.filter(row=>owned.workIds.includes(row.id)),
    outcomes:completionRows(state).filter(row=>owned.outcomeIds.includes(row.id)),
    sources:state.sources.filter(row=>owned.sourceIds.includes(row.id))
  };
}

export async function operateGrantCompletion({selected,context,server,caseId,stage,note,page}){
  const directory=join(stage,'grant-completion');await fs.mkdir(directory,{recursive:true,mode:0o700});
  const operationFile=join(directory,'operation.json'),base='/api/operations/'+caseId;
  const initial=await server.api(base);
  assert.equal(initial.program.mode,'WALKTHROUGH');
  assert.equal(initial.program.calendarStart,DATES.calendarStart);
  const costs=initial.plan.scenario.future_costs;
  assert.equal(costs.length,6);assert.equal(costs.reduce((total,row)=>total+Number(row.estimated_hours),0),400);
  assert.equal(costs.reduce((total,row)=>total+Number(row.amount_usd),0),38000);
  let state=await exists(operationFile)?JSON.parse(await fs.readFile(operationFile,'utf8')):{
    schema:'stellar-forge.sf47-completion-native-operation.v1',operationId:'grant-completion-'+randomUUID(),
    caseId,sourcePin:selected.sourceCommit,planSha256:initial.plan.contentSha256,
    startedAt:new Date().toISOString(),status:'RUNNING',phases:{},browserErrors:[]
  };
  assert.equal(state.caseId,caseId,'same native grant case');
  assert.equal(state.planSha256,initial.plan.contentSha256,'same original six-package source');
  const pageError=error=>state.browserErrors.push(error.message);
  page.on('pageerror',pageError);
  try{
  const save=()=>atomicJson(operationFile,state);
  const phase=async(name,work)=>{
    if(state.phases[name]?.status==='COMPLETE')return state.phases[name].result;
    state.currentPhase=name;state.status='RUNNING';await save();
    try{
      const result=await work();
      state.phases[name]={status:'COMPLETE',completedAt:new Date().toISOString(),result};await save();
      await note('grant completion: '+name,{caseId,phase:name,status:'COMPLETE'});return result;
    }catch(error){state.status='FAILED';state.lastError={phase:name,at:new Date().toISOString(),message:String(error.stack||error)};await save();throw error;}
  };
  const current=()=>server.api(base);
  const view=asOf=>server.api(base+'/completion?asOfDate='+encodeURIComponent(asOf));
  const retainedRequest=async(name,body)=>{
    const path=join(directory,'request-'+name+'.json');
    if(await exists(path))return JSON.parse(await fs.readFile(path,'utf8'));
    const request={expectedVersion:(await current()).program.version,requestId:state.operationId+'-'+name,
      actor:ACTOR,note:BASIS,...body};
    await originalFile(path,json(request));return request;
  };
  const command=async(name,action,data)=>{
    const request=await retainedRequest(name,{action,data});
    const result=await server.api(base+'/command',request);
    await originalFile(join(directory,'response-'+name+'.json'),json(result));
    return result;
  };
  const preview=async(receiptId,asOfDate,summary)=>{
    const value=await server.api(base+'/completion-preview',{
      expectedVersion:(await current()).program.version,receiptId,asOfDate,summary});
    return value;
  };
  const source=await phase('retain-original-walkthrough-input',async()=>{
    const input={schema:'stellar-forge.sf47-completion-native-input.v1',mode:'WALKTHROUGH',
      purpose:BASIS,ruleSource:RULE_URL,selectedSource:selected.sourceCommit,
      originalPlanSha256:initial.plan.contentSha256,originalPackages:costs,dates:DATES};
    const raw=Buffer.from(json(input)),file=await originalFile(join(directory,'completion-input.json'),raw);
    const receipt=await command('input-source','source.add',{
      filename:'completion-input.json',mediaType:'application/json',kind:'other',
      sourceUrl:'',observedAt:state.startedAt,contentBase64:raw.toString('base64')
    });
    const downloaded=await server.api(base+'/sources/'+receipt.recordId,undefined,{bytes:true});
    assert.deepEqual(downloaded,raw);
    return{...file,sourceId:receipt.recordId};
  });
  const people=await phase('assign-original-deliverables',async()=>{
    const people=[];
    for(const [index,name]of ['Delivery engineer role','Receiving maintainer role'].entries()){
      const receipt=await command('contributor-'+index,'contributor.save',{
        name,kind:'ROLE',contact:'',note:BASIS,sourceIds:[source.sourceId],sourceNote:BASIS});
      people.push(receipt.recordId);
    }
    const plans=[];
    for(const tranche of [1,2,3]){
      const seeded=await server.api(base+'/completion-seed',{expectedVersion:(await current()).program.version,tranche});
      assert.equal(seeded.inputs.items.length,2);
      const inputs=clone(seeded.inputs);
      for(const [index,item]of inputs.items.entries()){
        item.ownerIds=[people[index]];item.sourceIds=[source.sourceId];item.note=BASIS;
      }
      inputs.note='Original six-package grant delivery assignments in the receiving walkthrough.';
      const receipt=await command('plan-'+tranche,'completion.save',{inputs});
      plans.push({tranche,id:receipt.recordId,inputs});
    }
    const dashboard=await view('2027-12-01');
    assert.deepEqual(dashboard.tranches.map(row=>row.awardSubmitDate),['2027-12-31','2028-02-29','2028-04-29']);
    assert.equal(dashboard.clocks.length,0);
    return{people,plans};
  });
  const paymentInput=(payment,reference)=>({
    direction:'IN',category:'GRANT',date:payment.paidOn,currency:'USD',
    network:'',asset:'',amount:payment.amount,tranche:payment.tranche,
    externalRef:reference,sourceIds:[source.sourceId],sourceNote:BASIS,allocations:[]
  });
  const initialPayment=await phase('correct-original-payment-and-replay',async()=>{
    const wrong=await command('payment-zero-original','cash.record',
      paymentInput({...DATES.payments[0],paidOn:'2027-12-02'},'walkthrough-payment-zero-original'));
    assert.equal(byReceipt(await view('2027-12-03'),wrong.recordId).deadlineOn,'2028-03-01');
    const request=JSON.parse(await fs.readFile(join(directory,'request-payment-zero-original.json'),'utf8'));
    assert.deepEqual(await server.api(base+'/command',request),wrong,'same request returns its saved original receipt');
    const duplicate={...request,requestId:state.operationId+'-duplicate-original-payment',
      expectedVersion:(await current()).program.version};
    await assert.rejects(server.api(base+'/command',duplicate),error=>error.status===409&&error.code==='DUPLICATE_CASH');
    await command('payment-zero-void','cash.void',{id:wrong.recordId});
    const corrected=await command('payment-zero-corrected','cash.record',
      paymentInput(DATES.payments[0],'walkthrough-payment-zero-original'));
    const dashboard=await view('2028-02-29');
    assert.equal(byReceipt(dashboard,wrong.recordId).status,'PAYMENT_VOID');
    const clock=byReceipt(dashboard,corrected.recordId);
    assert.equal(clock.originalDeadlineOn,'2028-02-29');assert.equal(clock.deadlineOn,'2028-02-29');
    assert.equal(clock.daysRemaining,0);assert.equal(clock.status,'DUE_TODAY');
    return{voidId:wrong.recordId,receiptId:corrected.recordId,clock};
  });
  const paymentIds=[initialPayment.voidId,initialPayment.receiptId],workIds=[],outcomeIds=[],reviewIds=[];
  const planByTranche=new Map(people.plans.map(row=>[row.tranche,row]));
  let priorReceiptId=initialPayment.receiptId;
  for(const dates of DATES.submissions){
    const tranche=dates.tranche;
    const completed=await phase('complete-tranche-'+tranche,async()=>{
      const originalPlan=planByTranche.get(tranche),inputs=clone(originalPlan.inputs),work=[];
      for(const [index,item]of inputs.items.entries()){
        const cost=costs.find(row=>row.id===item.costId);
        const receipt=await command('work-'+tranche+'-'+index,'work.save',{
          contributorId:people.people[index],costId:item.costId,
          description:'Complete the retained walkthrough work package: '+cost.remaining_work,
          startDate:item.startDate,endDate:dates.completedOn,hours:String(cost.estimated_hours),
          fundingBasis:'INTERNAL',sourceIds:[source.sourceId],sourceNote:BASIS
        });
        work.push(receipt.recordId);
        item.state='COMPLETE';item.completedOn=dates.completedOn;item.workIds=[receipt.recordId];
        item.completionNote='Operated completion record for the original selected work package in this WALKTHROUGH case.';
      }
      if(tranche===1){
        await savePlanInBrowser({server,caseId,page,context,inputs,directory,state,save});
      }else await command('complete-plan-'+tranche,'completion.save',{inputs});
      return{inputs,workIds:work};
    });
    workIds.push(...completed.workIds);
    if(tranche===3){
      await phase('retain-confirmed-extension-on-original-clock',async()=>{
        if(!state.originalTrancheThreeDeadline){
          const overdue=byReceipt(await view('2028-06-30'),priorReceiptId);
          assert.equal(overdue.originalDeadlineOn,'2028-06-29');assert.equal(overdue.status,'OVERDUE');
          state.originalTrancheThreeDeadline=clone(overdue);await save();
        }
        const extension=await command('tranche-three-extension','completion.extension',{
          receiptId:priorReceiptId,confirmedOn:DATES.extension.confirmedOn,
          deadlineOn:DATES.extension.deadlineOn,reference:'walkthrough-extension-three-confirmed',
          sourceIds:[source.sourceId],note:BASIS
        });
        const extended=byReceipt(await view('2028-06-30'),priorReceiptId);
        assert.equal(extended.originalDeadlineOn,'2028-06-29');assert.equal(extended.deadlineOn,'2028-07-15');
        assert.equal(extended.extension.id,extension.extensionId);assert.equal(extended.status,'OPEN');
        const beforeConfirmation=byReceipt(await view('2028-06-19'),priorReceiptId);
        assert.equal(beforeConfirmation.deadlineOn,'2028-06-29');assert.equal(beforeConfirmation.extension,null);
        return{extensionId:extension.extensionId,clock:extended};
      });
    }
    const submitted=await phase('prepare-submit-tranche-'+tranche,async()=>{
      const summary='Tranche '+tranche+' receiving walkthrough: complete original assignments and retained source, calendar and form records.';
      const proposed=await preview(priorReceiptId,dates.submittedOn,summary);
      assert.equal(proposed.ready,true,JSON.stringify(proposed.issues));
      const again=await preview(priorReceiptId,dates.submittedOn,summary);
      assert.equal(again.previewSha256,proposed.previewSha256,'same native preparation is stable');
      if(tranche===1&&!state.stalePreviewExercised){
        await command('concurrent-before-preparation','review',{});
        const stale=await retainedRequest('stale-preparation',{
          action:'completion.prepare',data:{receiptId:priorReceiptId,asOfDate:dates.submittedOn,summary,
            expectedPreviewSha256:proposed.previewSha256}});
        await assert.rejects(server.api(base+'/command',stale),
          error=>error.status===409&&error.code==='COMPLETION_PREVIEW_CONFLICT');
        state.stalePreviewExercised={requestId:stale.requestId,code:'COMPLETION_PREVIEW_CONFLICT'};
        await save();
      }
      const fresh=await preview(priorReceiptId,dates.submittedOn,summary);
      const prepared=await command('prepare-tranche-'+tranche,'completion.prepare',{
        receiptId:priorReceiptId,asOfDate:dates.submittedOn,summary,expectedPreviewSha256:fresh.previewSha256});
      const review=await server.api(base+'/reviews/'+prepared.recordId);
      assert.equal(review.purpose,'TRANCHE_COMPLETION');assert.equal(review.completion.ready,true);
      assert.equal(review.businessSha256,prepared.businessSha256);
      const files=await retainPreparedFiles({server,base,review,directory,tranche});
      const saved=await command('submit-tranche-'+tranche,'completion.submit',{
        reviewId:prepared.recordId,expectedReviewSha256:prepared.businessSha256,
        submittedOn:dates.submittedOn,formReference:'walkthrough-form-tranche-'+tranche+'-original',
        sourceIds:[source.sourceId],sourceNote:BASIS
      });
      assert.equal(saved.submittedWithinDeadline,true);
      let final=saved,finalReview=prepared,revisionFiles=null;
      if(tranche===1){
        await command('tranche-one-changes','completion.decision',{
          outcomeId:saved.recordId,state:'CHANGES_REQUESTED',date:'2028-01-05',
          sourceIds:[source.sourceId],sourceNote:'Walkthrough reviewer requests an expanded handover description.'});
        const inputs=clone(completed.inputs);
        inputs.items[1].completionNote+=' The receiving description includes the original saved operation and assignment dates.';
        await command('tranche-one-revision','completion.save',{inputs});
        const revisedSummary=summary+' The receiving description is expanded in this submitted revision.';
        const revision=await preview(priorReceiptId,dates.resubmittedOn,revisedSummary);
        finalReview=await command('prepare-tranche-one-revised','completion.prepare',{
          receiptId:priorReceiptId,asOfDate:dates.resubmittedOn,summary:revisedSummary,
          expectedPreviewSha256:revision.previewSha256});
        const revisedReview=await server.api(base+'/reviews/'+finalReview.recordId);
        revisionFiles=await retainPreparedFiles({server,base,review:revisedReview,directory,tranche:'1-revised'});
        final=await command('submit-tranche-one-revised','completion.submit',{
          reviewId:finalReview.recordId,expectedReviewSha256:finalReview.businessSha256,
          submittedOn:dates.resubmittedOn,formReference:'walkthrough-form-tranche-1-revised',
          sourceIds:[source.sourceId],sourceNote:BASIS
        });
        const frozen=await server.api(base+'/reviews/'+prepared.recordId);
        assert.deepEqual(frozen,review,'the revised form preserves its earlier complete preparation');
      }
      await command('accept-tranche-'+tranche,'completion.decision',{
        outcomeId:final.recordId,state:'ACCEPTED',date:dates.acceptedOn,
        sourceIds:[source.sourceId],sourceNote:'Original recorded walkthrough decision for the submitted form.'});
      return{originalOutcomeId:saved.recordId,outcomeId:final.recordId,
        originalReviewId:prepared.recordId,reviewId:finalReview.recordId,files,revisionFiles};
    });
    outcomeIds.push(submitted.originalOutcomeId);
    if(submitted.outcomeId!==submitted.originalOutcomeId)outcomeIds.push(submitted.outcomeId);
    reviewIds.push(submitted.originalReviewId);
    if(submitted.reviewId!==submitted.originalReviewId)reviewIds.push(submitted.reviewId);
    const paid=await phase('receive-payment-'+tranche,async()=>{
      const payment=DATES.payments[tranche];
      const receipt=await command('payment-'+tranche,'cash.record',
        paymentInput(payment,'walkthrough-payment-'+tranche));
      const dashboard=await view(payment.paidOn);
      if(tranche<3){
        const clock=byReceipt(dashboard,receipt.recordId);
        assert.equal(clock.originalDeadlineOn,payment.deadlineOn);
        assert.equal(clock.daysRemaining,90);assert.equal(clock.status,'OPEN');
      }else{
        assert.ok(dashboard.finalPaymentIds.includes(receipt.recordId));
        assert.ok(!dashboard.clocks.some(row=>row.receiptId===receipt.recordId));
      }
      return{receiptId:receipt.recordId,payment};
    });
    paymentIds.push(paid.receiptId);priorReceiptId=paid.receiptId;
  }
  const result=await phase('retain-complete-grant-operation',async()=>{
    const original=await current(),owned={paymentIds,contributorIds:people.people,workIds,outcomeIds,sourceIds:[source.sourceId]};
    const selection=originalSelection(original,owned),dashboard=await view('2028-07-31'),reviews={};
    assert.equal(selection.completionPlans.length,3);assert.equal(selection.work.length,6);
    assert.equal(selection.outcomes.length,4);
    assert.equal(selection.outcomes.filter(row=>row.state==='ACCEPTED').length,3);
    assert.deepEqual(dashboard.tranches.map(row=>row.itemsComplete),[2,2,2]);
    for(const id of reviewIds)reviews[id]=await server.api(base+'/reviews/'+id);
    const retained={schema:'stellar-forge.sf47-completion-native-receiving.v1',caseId,owned,selection,
      clocks:dashboard.clocks,finalPaymentIds:dashboard.finalPaymentIds,reviews};
    const comparison=await originalFile(join(directory,'complete-original-case-selection.json'),json(retained));
    await openCompletion({page,server,caseId,asOfDate:'2028-07-31'});
    await page.screenshot({path:join(directory,'completion-original.png'),fullPage:true});
    assert.deepEqual(state.browserErrors,[]);
    return{...retained,comparison,source,sourcePin:selected.sourceCommit,phases:Object.keys(state.phases).length+1};
  });
  state.status='COMPLETE';state.completedAt=new Date().toISOString();state.result=result;delete state.currentPhase;await save();
  return{...result,directory,operationFile,operationId:state.operationId};
  }finally{page.off('pageerror',pageError);}
}

export async function verifyReceivedGrantCompletion({server,caseId,page,stage,completion}){
  const base='/api/operations/'+caseId,current=await server.api(base);
  assert.equal(current.program.mode,'WALKTHROUGH');
  assert.deepEqual(originalSelection(current,completion.owned),completion.selection);
  const dashboard=await server.api(base+'/completion?asOfDate=2028-07-31');
  assert.deepEqual(dashboard.clocks,completion.clocks);
  assert.deepEqual(dashboard.finalPaymentIds,completion.finalPaymentIds);
  for(const [id,review]of Object.entries(completion.reviews)){
    assert.deepEqual(await server.api(base+'/reviews/'+id),review);
  }
  const source=await server.api(base+'/sources/'+completion.source.sourceId,undefined,{bytes:true});
  assert.equal(digest(source),completion.source.sha256);assert.equal(source.length,completion.source.bytes);
  await openCompletion({page,server,caseId,asOfDate:'2028-07-31'});
  const visible=await page.locator('body').innerText();
  assert.ok(visible.includes('2028-07-15'),'received confirmed reporting deadline');
  await page.screenshot({path:join(stage,'grant-completion-received.png'),fullPage:true});
  return{originalCaseId:completion.caseId,caseId,mode:current.program.mode,
    completionPlans:current.completionPlans.length,completedPackages:6,submittedForms:completion.owned.outcomeIds.length,
    retainedSources:completion.owned.sourceIds.length,reviewCount:Object.keys(completion.reviews).length,
    deadline:'2028-07-15',sameOriginalRecords:true};
}

async function openCompletion({page,server,caseId,asOfDate}){
  await page.goto(server.url);
  await page.locator('[data-tab="operations"]').click();
  await page.locator('[name="caseSelect"]').selectOption(caseId);
  await page.locator('[data-ops-tab="completion"]').click();
  await page.locator('details[data-completion-item]').first().waitFor();
  const date=page.locator('[name="completionAsOfDate"]');
  if(await date.inputValue()!==asOfDate){
    const response=page.waitForResponse(value=>value.request().method()==='GET'&&
      value.url().includes('/completion?asOfDate='+asOfDate)&&value.status()===200);
    await date.fill(asOfDate);await date.dispatchEvent('change');await response;
  }
  await page.locator('.completion-desk[aria-busy="false"]').waitFor();
}

async function populateAssignments(page,inputs){
  const selected=page.locator('[name="completionTranche"]');
  if(await selected.inputValue()!==String(inputs.tranche)){
    await selected.selectOption(String(inputs.tranche));
  }
  for(const item of inputs.items){
    const card=page.locator('details[data-completion-item='+JSON.stringify(item.costId)+']');
    await card.waitFor();
    for(const key of ['ownerIds','workIds','deploymentIds','sourceIds']){
      await card.locator('[data-completion-field='+JSON.stringify(key)+']').selectOption(item[key]);
    }
    await card.locator('[data-completion-field="state"]').selectOption(item.state);
    for(const key of ['startDate','endDate','completedOn','completionNote','note']){
      await card.locator('[data-completion-field='+JSON.stringify(key)+']').fill(item[key]??'');
    }
  }
  await page.locator('[name="completionPlanNote"]').fill(inputs.note);
}

async function savePlanInBrowser({server,caseId,page,context,inputs,directory,state,save}){
  const base='/api/operations/'+caseId,commandPath=base+'/command';
  const retainedFile=join(directory,'browser-assignment-save.json');
  const savedInputs=async()=>{const current=await server.api(base);
    const plan=current.completionPlans.find(row=>row.tranche===inputs.tranche);
    assert.ok(plan);assert.deepEqual(plan.inputs,inputs);return{current,plan};};
  if(state.browserSave?.request){
    const original=state.browserSave;
    const result=await server.api(commandPath,original.request);
    if(original.result)assert.deepEqual(result,original.result);
    await savedInputs();
    original.result=result;original.status='RECOVERED_FROM_ORIGINAL_REQUEST';
    await originalFile(retainedFile,json(original.request));await save();
    return original;
  }
  await openCompletion({page,server,caseId,asOfDate:'2028-01-02'});
  await populateAssignments(page,inputs);
  let accept,failAccepted,release,finish,failFinished,held=false;
  const accepted=new Promise((resolve,reject)=>{accept=resolve;failAccepted=reject;});
  const released=new Promise(resolve=>{release=resolve;});
  const finished=new Promise((resolve,reject)=>{finish=resolve;failFinished=reject;});
  // Attach rejection observers before a native route can reject either waiter.
  accepted.catch(()=>{});finished.catch(()=>{});
  const pattern='**/api/operations/'+caseId+'/command';
  const handler=async route=>{
    const request=route.request();
    let payload;try{payload=request.postDataJSON();}catch{}
    if(held||request.method()!=='POST'||payload?.action!=='completion.save')return route.continue();
    held=true;
    try{
      state.browserSave={status:'ORIGINAL_REQUEST_RETAINED',request:payload,requestText:request.postData()};
      await originalFile(retainedFile,json(payload));await save();
      const response=await route.fetch();
      assert.equal(response.status(),200);
      const result=await response.json();
      state.browserSave.result=result;state.browserSave.status='ACCEPTED_RESPONSE_HELD';await save();
      accept(result);
      await released;
      await route.abort('failed');
      state.browserSave.status='ACCEPTED_RESPONSE_LOST';await save();finish();
    }catch(error){failAccepted(error);failFinished(error);await route.abort('failed').catch(()=>{});}
  };
  await context.route(pattern,handler);
  let first;
  const responseTimeout=setTimeout(()=>failAccepted(Error('The assignment save did not reach its original native response within 30 seconds.')),30000);
  try{
    await page.locator('[data-completion-action="save"]').click();
    first=await accepted;
    const native=await savedInputs();
    assert.equal(native.current.program.version,first.version);
    assert.equal(native.plan.id,first.recordId);
    // Dispose the child panel while its original accepted response is still held.
    await page.locator('[data-ops-tab="support"]').click();
    await page.locator('[data-support-file]').waitFor();
    release();await finished;
  }finally{clearTimeout(responseTimeout);release();await context.unroute(pattern,handler);}
  await page.locator('[data-ops-tab="completion"]').click();
  await page.locator('[data-completion-action="retry"]:enabled').waitFor();
  const retried=page.waitForResponse(response=>response.request().method()==='POST'&&
    response.url().endsWith(commandPath)&&response.request().postDataJSON()?.action==='completion.save');
  await page.locator('[data-completion-action="retry"]').click();
  const retryResponse=await retried,retryResult=await retryResponse.json();
  assert.equal(retryResponse.status(),200);
  assert.equal(retryResponse.request().postData(),state.browserSave.requestText,'retry preserves exact original browser request bytes');
  assert.deepEqual(retryResult,first,'retry reopens the original accepted assignment save');
  const after=await savedInputs();assert.equal(after.current.program.version,first.version);
  await page.locator('[data-completion-action="save"]:enabled').waitFor();
  state.browserSave.status='COMPLETE';state.browserSave.replayedResult=retryResult;
  state.browserSave.finalVersion=after.current.program.version;await save();
  await page.screenshot({path:join(directory,'completion-assignments-retained.png'),fullPage:true});
  return state.browserSave;
}

const READ_PREPARED_ZIP=String.raw`
import csv, hashlib, html, io, json, pathlib, sys, zipfile
archive_path, review_path = map(pathlib.Path, sys.argv[1:3])
expected = json.loads(review_path.read_text(encoding="utf-8"))
with zipfile.ZipFile(archive_path) as archive:
    names = archive.namelist()
    assert len(names) == len(set(names)), "duplicate prepared files"
    assert all(not pathlib.PurePosixPath(name).is_absolute() and ".." not in pathlib.PurePosixPath(name).parts for name in names)
    manifest = json.loads(archive.read("MANIFEST.json"))
    assert manifest["schema"] == "stellar-forge.sf47-completion-files.v1"
    assert manifest["reviewId"] == expected["id"]
    listed = [row["path"] for row in manifest["files"]]
    assert len(listed) == len(set(listed))
    assert set(listed) == set(names) - {"MANIFEST.json"}
    for entry in manifest["files"]:
        raw = archive.read(entry["path"])
        assert len(raw) == entry["bytes"]
        assert hashlib.sha256(raw).hexdigest() == entry["sha256"]
    actual = json.loads(archive.read("completion.json"))
    assert actual == expected, "complete frozen preparation changed in ZIP"
    candidate = actual["completion"]
    snapshot = actual["snapshot"]
    source_ids = set(candidate["receipt"]["sourceIds"])
    extension = candidate["clock"]["extension"]
    if extension:
        source_ids.update(extension["sourceIds"])
    items = candidate["completionPlan"]["inputs"]["items"]
    for item in items:
        source_ids.update(item["sourceIds"])
        for kind, key in (("work", "workIds"), ("deployments", "deploymentIds")):
            for ident in item[key]:
                record = next(row for row in snapshot["records"][kind] if row["id"] == ident)
                source_ids.update(record["sourceIds"])
    actual_sources = {name[len("sources/"):] for name in names if name.startswith("sources/")}
    assert actual_sources == source_ids, "prepared source selection"
    for ident in source_ids:
        metadata = next(row for row in snapshot["sources"] if row["id"] == ident)
        raw = archive.read("sources/" + ident)
        assert len(raw) == metadata["bytes"]
        assert hashlib.sha256(raw).hexdigest() == metadata["sha256"]
    page = archive.read("completion.html").decode("utf-8")
    assert html.escape(candidate["summary"], quote=True) in page
    for key in ("originalDeadlineOn", "deadlineOn"):
        assert candidate["clock"][key] in page
    assert candidate["receipt"]["date"] in page
    records = list(csv.DictReader(io.StringIO(archive.read("deliverables.csv").decode("utf-8-sig"))))
    assert len(records) == len(items)
    for item in items:
        row = next(value for value in records if value["costId"] == item["costId"])
        for key in ("state", "completedOn", "completionNote", "startDate", "endDate"):
            assert row[key] == str(item[key] or ""), "retained CSV field " + key
        original = next(value for value in candidate["packages"] if value["costId"] == item["costId"])
        assert row["remainingWork"] == original["remainingWork"]
        assert row["successCriteria"] == original["successCriteria"]
        assert html.escape(item["completionNote"], quote=True) in page
    print(json.dumps({"reviewId": actual["id"], "files": len(names), "sources": len(source_ids),
                      "deliverables": len(records), "originalDeadlineOn": candidate["clock"]["originalDeadlineOn"],
                      "deadlineOn": candidate["clock"]["deadlineOn"], "exactFrozenPreparation": True}))
`;

async function retainPreparedFiles({server,base,review,directory,tranche}){
  const path=join(directory,'tranche-'+tranche+'-completion.zip');
  const bytes=await server.api(base+'/completion-reviews/'+review.id+'/export.zip',undefined,{bytes:true});
  const file=await originalFile(path,bytes);
  const expectedPath=join(directory,'tranche-'+tranche+'-preparation.json');
  await originalFile(expectedPath,json(review));
  const python=process.env.SF47_PYTHON||'python3';
  const result=await execute(python,['-c',READ_PREPARED_ZIP,path,expectedPath],{
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},maxBuffer:1024*1024,timeout:30000});
  const inspected=JSON.parse(result.stdout);
  assert.equal(inspected.reviewId,review.id);assert.equal(inspected.deliverables,2);
  assert.equal(inspected.sources,1);
  return{...file,...inspected};
}
