/**
 * Complete working-desk receiving on the original geographic course's Page.
 * TokenJunkieLabs. No browser launch, provider write, Prepare or Combine.
 */
export async function operateSourceWorkingDesk({
 page,workspaceKey,download,readJSON,saveRecord,screenshot,waitFor,check,
 equal,requireValue,navigate,action
}){
 check();
 const openWorking=async()=>{const d=page.locator('[data-sp-working] details');await d.waitFor({state:'visible'});if(!await d.evaluate(n=>n.open))await d.locator('summary').click();};
 const openMerge=async()=>{const d=page.locator('[data-sp-merge]');await d.waitFor({state:'visible'});if(!await d.evaluate(n=>n.open))await d.locator('summary').click();};
 const readCurrent=async label=>{await openWorking();const saved=await download(page.locator('[data-sp-action="download-desk"]'),label);const document=await readJSON(saved.file);requireValue(document.schema==='upstate.source-working-desk/v2'&&document.workspace_key===workspaceKey,'Open the complete original Workspace desk');return {saved,document};};
 const selections=file=>({method:file.state.method,drafts:file.state.drafts,merge:file.state.merge,
   requests:file.state.requests,retired_requests:file.state.retired_requests||[],
   upload_receipts:file.state.upload_receipts,input_history:file.state.input_history});
 const expectMessage=label=>waitFor(async()=>{
  const failure=page.locator('[data-sp-error]');
  if(await failure.isVisible())throw new Error(await failure.textContent());
  return (await page.locator('[data-sp-message]').textContent()).includes(label);
 },label);
 const importFile=async(file,label='Complete working desk reopened')=>{
  await openWorking();
  const expected=await readJSON(file),input=page.locator('[data-sp-desk-file]');
  // Listen before selection. A previous success/error message cannot acknowledge
  // this file's asynchronous hash, import validation and durable state write.
  const completion=await input.evaluateHandle(element=>{
   const ancestors=new Set();for(let node=element.parentNode;node;node=node.parentNode)ancestors.add(node);
   const state={complete:false,method:null};
   const receive=event=>{
    if(event.detail?.complete_desk!==true||!ancestors.has(event.target))return;
    state.complete=true;state.method=event.detail.method;
    document.removeEventListener('source-selection-replaced',receive);
   };
   document.addEventListener('source-selection-replaced',receive);
   state.stop=()=>document.removeEventListener('source-selection-replaced',receive);
   return state;
  });
  try{
   await input.setInputFiles(file);
   await waitFor(()=>completion.evaluate(state=>state.complete),'new complete working-desk import');
   requireValue(await completion.evaluate(state=>state.method)===expected.state.method,'The completed import selected a different original method');
   await expectMessage(label);
  }catch(error){
   const failure=page.locator('[data-sp-error]');
   if(await failure.isVisible().catch(()=>false)){
    const message=await failure.textContent().catch(()=>null);
    if(message)throw new Error(error.message+'; current working-desk error: '+message);
   }
   throw error;
  }finally{
   await completion.evaluate(state=>state.stop()).catch(()=>{});
   await completion.dispose().catch(()=>{});
  }
 };
 const original=await readCurrent('complete-source-desk-original');
 requireValue(original.document.state.method,'The original receiving desk has no selected method');
 await saveRecord('complete-source-desk-original-identity',{workspace_key:workspaceKey,
   file:original.saved.item,namespace:original.document.namespace,actions:original.document.actions,
   dispatch_requests:original.document.state.requests,retired_requests:original.document.state.retired_requests||[]});
 const nativeRequests=[];
 const observeRequest=request=>{if(new URL(request.url()).pathname==='/api/actions'){let body=null;try{body=request.postDataJSON();}catch{}nativeRequests.push({method:request.method(),action:body?.action||null});}};
 page.on('request',observeRequest);
 let restored=false,failed=null;
 try{
  await page.locator('[data-sp-title]').fill(original.document.state.drafts[original.document.state.method].title+' · full desk receiving');
  await openMerge();
  await page.locator('[data-sp-compose-title]').fill('Complete original input selection · receiving draft');
  const choice=page.locator('[data-sp-merge-kind="collections"]').first();
  if(await choice.count())await choice.check();
  const importChoice=page.locator('[data-sp-compose-import]');
  await importChoice.setChecked(!original.document.state.merge.import_sources);
  const numeric=page.locator('[data-sp-numeric]').first();
  let numericName=null;
  if(await numeric.count()){numericName=await numeric.getAttribute('data-sp-option');await numeric.fill('-');}
  const edited=await readCurrent('complete-source-desk-edited');
  requireValue(edited.document.state.merge.title==='Complete original input selection · receiving draft','The original combined title was not retained');
  requireValue(edited.document.state.drafts[edited.document.state.method].title.endsWith(' · full desk receiving'),'The full method draft was not retained');
  if(numericName)requireValue(edited.document.state.drafts[edited.document.state.method].numeric_text?.[numericName]?.text==='-','The unfinished numeric text was lost');
  requireValue(equal(edited.document.state.requests,original.document.state.requests),'Editing working choices issued or replaced an original request');
  const other=await page.locator('[data-sp-method] option').evaluateAll((rows,current)=>rows.find(row=>row.value!==current&&!row.textContent.startsWith('Unavailable method'))?.value||null,original.document.state.method);
  if(other){
   await page.locator('[data-sp-method]').selectOption(other);
   await page.locator('[data-sp-title]').fill('Independent retained method · receiving draft');
   await page.locator('[data-sp-method]').selectOption(original.document.state.method);
   if(numericName)requireValue(await page.locator('[data-sp-option="'+numericName+'"]').inputValue()==='-','Changing method lost its unfinished numeric choice');
  }
  const wholeEdited=await readCurrent('complete-source-desk-all-methods');
  const rejected=JSON.parse(JSON.stringify(wholeEdited.document));rejected.workspace_key+='-different-workspace';
  const rejectedPath=await saveRecord('complete-source-desk-foreign-input',rejected);
  requireValue(equal(await readJSON(rejectedPath),rejected),'The retained receiving input changed');
  await openWorking();await page.locator('[data-sp-desk-file]').setInputFiles(rejectedPath);
  await waitFor(async()=>await page.locator('[data-sp-error]').isVisible(),'foreign original Workspace rejected');
  const afterRejected=await readCurrent('complete-source-desk-after-foreign-refusal');
  requireValue(equal(selections(afterRejected.document),selections(wholeEdited.document)),'Foreign working file partially changed original choices');

  // A deliberately unavailable working reference is a receiving fixture only.
  // It is retained as unfinished choice history and is never dispatched natively.
  const missing=JSON.parse(JSON.stringify(wholeEdited.document)),missingId='receiving-unavailable-source-'+workspaceKey;
  missing.state.merge.collections=[...new Set([...missing.state.merge.collections,missingId])];
  missing.state.merge.open=true;
  missing.source_descriptions.push({key:'collections:'+missingId,kind:'collections',id:missingId,title:'Unavailable reference used only by the working-file receiving course',available:false,status:'Receiving fixture; no scientific source asserted'});
  const missingPath=await saveRecord('complete-source-desk-missing-input',missing);
  requireValue(equal(await readJSON(missingPath),missing),'The complete missing-reference receiving input changed');
  await importFile(missingPath);
  await openMerge();
  requireValue(await page.locator('[data-sp-action="remove-merge-missing"][data-sp-id="'+missingId+'"]').count()===1,'The retained missing choice is not visible');
  requireValue(await page.locator('[data-sp-compose-form] button[type="submit"]').isDisabled(),'Unavailable combined input could be dispatched');
  const missingDownloaded=await readCurrent('complete-source-desk-missing-retained');
  requireValue(missingDownloaded.document.state.merge.collections.includes(missingId),'The absent original choice was silently removed');
  await screenshot(page,'source-working-desk-missing',1440);await screenshot(page,'source-working-desk-missing',390);
  await page.locator('[data-sp-action="remove-merge-missing"][data-sp-id="'+missingId+'"]').click();
  const removed=await readCurrent('complete-source-desk-explicit-removal');
  requireValue(!removed.document.state.merge.collections.includes(missingId)&&removed.document.desk_history.some(row=>row.state.merge.collections.includes(missingId)),'Explicit removal lost complete original choice history');

  await importFile(wholeEdited.saved.file);
  const restoredEdited=await readCurrent('complete-source-desk-reopened');
  requireValue(equal(selections(restoredEdited.document),selections(wholeEdited.document)),'Complete working-file reopen changed an original method, composition or request');
  await importFile(wholeEdited.saved.file);
  const repeated=await readCurrent('complete-source-desk-repeated');
  requireValue(equal(repeated.document,restoredEdited.document),'Reopening the same complete file was not a no-op');
  await page.reload({waitUntil:'domcontentloaded'});await navigate('geographic-headwaters');
  await waitFor(async()=>await page.locator('[data-sp-title]').count()>0&&await page.locator('[data-sp-title]').inputValue()===wholeEdited.document.state.drafts[wholeEdited.document.state.method].title,'cold complete working desk');
  const cold=await readCurrent('complete-source-desk-cold-reopen');
  requireValue(equal(selections(cold.document),selections(wholeEdited.document)),'Actual reload lost complete selected methods, composition or original request history');
  await screenshot(page,'source-working-desk-cold',1440);await screenshot(page,'source-working-desk-cold',390);
  await saveRecord('complete-source-desk-receiving',{schema:'upstate.source-working-desk-receiving/v1',workspace_key:workspaceKey,
   original:original.saved.item,edited:wholeEdited.saved.item,reopened:restoredEdited.saved.item,cold:cold.saved.item,
   numeric_option:numericName,second_installed_method:other,
   unavailable_reference_fixture:missingId,foreign_workspace_rejected:true,
   exact_dispatch_requests:original.document.state.requests,native_dispatch:false});
 }catch(error){failed=error;}
 finally{
  try{
   check();
   if(await page.locator('[data-sp-desk-file]').count()===0){await navigate('geographic-headwaters');await waitFor(async()=>await page.locator('[data-sp-desk-file]').count()===1,'original working desk for restoration');}
   await importFile(original.saved.file);
   const final=await readCurrent('complete-source-desk-original-restored');
   requireValue(equal(selections(final.document),selections(original.document)),'The complete original scientific choices were not restored');
   restored=true;
   await saveRecord('complete-source-desk-restoration',{original:original.saved.item,current:final.saved.item,complete_original_choice_restored:true});
  }catch(error){
   await saveRecord('complete-source-desk-restoration-required',{original:original.saved.item,workspace_key:workspaceKey,message:error.message});
   if(!failed)failed=error;
  }
 }
 page.off('request',observeRequest);
 if(failed)throw failed;
 requireValue(restored,'Retain and restore the original complete desk before continuing scientific preview');
 requireValue(nativeRequests.length===0,'Working-file receiving unexpectedly dispatched a native action');
 // This helper contains no request to the native action endpoint. The parent
 // also verifies unchanged original scientific record IDs after its full course.
 action('complete_source_working_desk',{workspace_key:workspaceKey,original_restored:true,native_dispatch:false,
  observed_native_requests:nativeRequests});
 return {schema:'upstate.source-working-desk-receiving/v1',workspace_key:workspaceKey,original_restored:true};
}
