/** Operate the delivered original customer review in the receiving browser. */
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const stable=value=>JSON.stringify(value,(_key,item)=>
 item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const withoutTime=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='created_at'));

export async function operateGeographicReview({
 context,delivered,record,attemptRoot,artifact,screenshot,action,check,waitFor
}){
 check();
 const root=join(delivered,'customer-review');
 const packet=await read(join(root,'review.json'));
 requireValue(packet.schema==='upstate.customer-review-packet/v1'&&
  packet.review?.id===record.review.review_id&&
  packet.review?.project?.id===record.review.project_id&&
  packet.latest_response_id===record.review.latest_response_id,
  'Open the same delivered original customer review and response generation');
 requireValue(Array.isArray(packet.responses)&&Array.isArray(packet.review.artifacts)&&
  Array.isArray(packet.review.requirements),'The original review packet is incomplete');
 const originalResponses=stable(packet.responses);
 const page=await context.newPage();
 const url=pathToFileURL(join(root,'index.html')).href;
 let firstResponse=null;
 async function capture(label){
  check();await screenshot(page,label,1440);await screenshot(page,label,390);
 }
 async function selectTab(name){
  check();await page.locator('#tab-'+name).click();
  await page.locator('#pane-'+name).waitFor({state:'visible'});
  requireValue(await page.locator('#tab-'+name).getAttribute('aria-selected')==='true',
   'The original review tab did not open: '+name);
 }
 async function exported(label){
  check();
  const [download]=await Promise.all([
   page.waitForEvent('download'),page.locator('#export-response').click()
  ]);
  const path=join(attemptRoot,'downloads',label+'.json');
  await download.saveAs(path);
  requireValue(!(await download.failure()),'The actual review response download failed');
  const body=await read(path);
  requireValue(body.schema==='upstate.customer-review-response/v1'&&
   body.review_id===packet.review.id&&body.project_id===packet.review.project.id&&
   body.previous_response_id===packet.latest_response_id,
   'The downloaded response changed its original review, project or parent');
  await artifact(path,label);
  return {path,body};
 }
 try{
  await page.goto(url,{waitUntil:'load'});
  const embedded=await page.locator('#review-data').textContent();
  requireValue(stable(JSON.parse(embedded))===stable(packet),
   'The displayed customer review differs from its delivered original packet');
  await page.locator('#reviewer-name').waitFor({state:'visible'});
  await capture('review-overview-original');

  await selectTab('files');
  const rows=page.locator('#file-rows tr[data-artifact-id]');
  requireValue(await rows.count()===packet.review.artifacts.length,
   'The delivered review must expose its complete original file selection');
  if(packet.review.artifacts.length){
   const first=packet.review.artifacts[0];
   await page.locator('#file-search').fill(first.label||first.original_path||first.id);
   await waitFor(async()=>await rows.count()>0,'original review file search');
   await capture('review-file-search');
   await page.locator('#file-search').fill('');
   await waitFor(async()=>await rows.count()===packet.review.artifacts.length,
    'complete review files after clearing search');
   let selected=null;
   for(const row of await rows.all()){
    if(await row.getAttribute('data-artifact-id')===first.id){selected=row;break;}
   }
   requireValue(selected,'The original review file disappeared after clearing search');
   await selected.locator('button').first().click();
   const detail=page.locator('#file-detail');
   await detail.locator('h2').waitFor({state:'visible'});
   requireValue((await detail.textContent()).includes(first.sha256),
    'The selected original file identity is absent from its review detail');
   await detail.locator('details.source-details').first().locator('summary').click();
   await capture('review-original-file');
  }
  for(const tab of ['requirements','corrections','history']){
   await selectTab(tab);await capture('review-'+tab+'-original');
  }
  await selectTab('overview');
  // This private receiving profile starts a local internal draft. Original
  // recorded responses remain in the packet and the scientific Workspace.
  await page.locator('#reset-draft').click();
  await page.locator('#reviewer-name').fill('Internal receiving operator');
  await page.getByLabel('Role',{exact:true}).fill('Application handover');
  await page.getByLabel('Organization',{exact:true}).fill('TokenJunkieLabs');
  await page.getByLabel('Overall response',{exact:true}).selectOption('in-review');
  const summary='Internal handover draft: the original geographic review, source files, requirements and response history are available for the receiving analyst. Scientific decisions remain open.';
  await page.getByLabel('Response summary',{exact:true}).fill(summary);
  firstResponse=await exported('geographic-review-internal-draft');
  requireValue(firstResponse.body.disposition==='in-review'&&
   firstResponse.body.reviewer.name==='Internal receiving operator'&&
   firstResponse.body.summary===summary&&
   firstResponse.body.artifact_decisions.length===packet.review.artifacts.length&&
   firstResponse.body.requirement_decisions.length===packet.review.requirements.length&&
   [...firstResponse.body.artifact_decisions,...firstResponse.body.requirement_decisions]
     .every(item=>item.decision==='unreviewed')&&firstResponse.body.corrections.length===0,
   'The internal browser draft must preserve the open scientific decisions');
  await capture('review-internal-draft');

  await page.getByLabel('Response summary',{exact:true}).fill(summary+' Local draft edit.');
  // The app debounces its ordinary local save. Wait for that saved draft before
  // importing, so an actual draft-conflict mechanism is never bypassed.
  await waitFor(async()=>await page.evaluate(({reviewId,summary})=>{
   for(let i=0;i<localStorage.length;i++){
    let row;try{row=JSON.parse(localStorage.getItem(localStorage.key(i)));}catch{continue;}
    if(row?.schema==='upstate.customer-review-draft/v1'&&row.review_id===reviewId&&
       row.response?.summary===summary)return true;
   }
   return false;
  },{reviewId:packet.review.id,summary:summary+' Local draft edit.'}),
  'the review application saved its local draft');
  await page.locator('#response-file').setInputFiles(firstResponse.path);
  await waitFor(async()=>{
   const notice=await page.locator('#notice-text').textContent();
   if(notice.startsWith('Response import:'))throw new Error(notice);
   return notice.includes('Imported the local response as your current draft')&&
    await page.getByLabel('Response summary',{exact:true}).inputValue()===summary;
  },'original response download reopened as its local draft');
  const reopened=await exported('geographic-review-reopened-draft');
  requireValue(stable(withoutTime(reopened.body))===stable(withoutTime(firstResponse.body)),
   'Importing the original browser response changed its editable content');
  await capture('review-response-reopened');
  await page.reload({waitUntil:'load'});
  await page.locator('#reviewer-name').waitFor({state:'visible'});
  requireValue(await page.locator('#reviewer-name').inputValue()==='Internal receiving operator'&&
   await page.getByLabel('Response summary',{exact:true}).inputValue()===summary,
   'The saved response draft did not survive the actual review page reload');
  const reloaded=await exported('geographic-review-reloaded-draft');
  requireValue(stable(withoutTime(reloaded.body))===stable(withoutTime(firstResponse.body)),
   'The original browser draft changed after reloading the delivered review');
  await selectTab('history');await capture('review-history-after-reopen');
  const afterPacket=await read(join(root,'review.json'));
  requireValue(stable(afterPacket.responses)===originalResponses&&stable(afterPacket)===stable(packet),
   'The original delivered response history changed during browser receiving');
  action('customer_review_draft_download_import_reload',{
   review_id:packet.review.id,project_id:packet.review.project.id,
   previous_response_id:packet.latest_response_id,original_responses:packet.responses.length,
   original_artifacts:packet.review.artifacts.length,original_requirements:packet.review.requirements.length,
   disposition:firstResponse.body.disposition,scope:'Private internal receiving browser draft',
   native_response_history:'Preserved original exported generation'
  });
 }finally{
  await page.close();
 }
}
