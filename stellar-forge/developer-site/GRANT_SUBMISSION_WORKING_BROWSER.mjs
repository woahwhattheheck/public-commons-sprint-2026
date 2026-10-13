// MIT. Continue the original selected application/browser operation; no browser owner here.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
/**
 * The original 22B7/81CF receiving owner supplies its already-open browser Page,
 * real served application URL and actual saved draft. No source or issuer facts
 * are fabricated. This is an explicit successor step of that same operation.
 */
export async function receiveSubmissionWorkingCopy({page,baseUrl,draftId,directory}){
  need(page&&typeof page.goto==='function'&&typeof draftId==='string'&&draftId,'Supply the original browser and saved application identity.');
  directory=path.resolve(directory);await fs.mkdir(directory,{recursive:true});
  const app=new URL('grant-submission.html',baseUrl);app.searchParams.set('draft',draftId);
  const files=[],screenshots=[];
  const record=async(name,bytes,mediaType)=>{const target=path.join(directory,name);await fs.writeFile(target,bytes);const reread=await fs.readFile(target);need(reread.equals(Buffer.from(bytes)),'Complete receiving file changed.');const value={name,path:target,bytes:reread.length,sha256:sha(reread),mediaType};files.push(value);return value;};
  const download=async(label,name,mediaType)=>{const waiting=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const item=await waiting;const target=path.join(directory,name);await item.saveAs(target);return record(name,await fs.readFile(target),mediaType);};
  const snapshot=()=>page.evaluate(async()=>{
    const node=document.getElementById('workspace-root'),module=await import('./grant-submission-working-copy.mjs');
    return (await module.loadSubmissionWorkingCopy(node.dataset.workingId)).input;
  });
  const settled=()=>page.waitForFunction(()=>{const e=document.getElementById('working-status');return e?.textContent.includes('Complete working copy saved')&&!document.getElementById('workspace-root').inert;});
  const screen=async(name,width)=>{await page.setViewportSize({width,height:980});const target=path.join(directory,name);await page.screenshot({path:target,fullPage:true});screenshots.push({path:target,width,viewed:false});};
  await page.goto(app.href);await settled();
  const initial=await snapshot();need(initial.draft&&initial.native.id===draftId,'The original saved application was not selected.');
  need(initial.draft.fields.length>0,'Continue the actual saved form receiving case with its original mapped fields.');
  const field=initial.draft.fields[0],answer=initial.draft.answers.find(row=>row.id==='project');
  const initialNative=await page.evaluate(async id=>(await import('./drafts.mjs')).loadDraft(id),draftId);
  await record('original-native-record.json',JSON.stringify(initialNative)+'\n','application/json');
  await page.locator('#view').selectOption('fields');
  await page.getByRole('button',{name:'Prepare workbook from current form',exact:true}).click();
  await settled();
  await page.getByText('Edit or paste complete worksheet text',{exact:true}).click();
  const originalSheet=await page.getByLabel('Fields worksheet',{exact:true}).inputValue();
  await page.getByLabel('Fields worksheet',{exact:true}).fill(originalSheet+'"');
  await page.getByLabel('Issuer word limit',{exact:true}).fill('0.');
  await settled();
  await page.locator('#view').selectOption('answers');
  await page.getByLabel('Draft answer',{exact:true}).fill(answer.text+'\n');
  await page.locator('#refresh-source').click();
  await page.waitForFunction(()=>document.getElementById('workspace-root').dataset.sourceReadState==='idle');
  await settled();
  const pending=await snapshot();need(pending.incoming?.bundle&&pending.draft.currentSource===initial.draft.currentSource,'Reading source must retain a full comparison without receiving it.');
  need(pending.limits.find(row=>row.fieldId===field.id)?.wordLimit==='0.'&&pending.workbook?.fields===originalSheet+'"','The complete raw unfinished controls were not saved.');
  need(pending.draft.answers.find(row=>row.id==='project').text===answer.text+'\n','Edited answer text was not retained exactly.');
  const oldWorkingId=pending.id;
  await page.reload();await settled();const reopened=await snapshot();
  need(reopened.id!==oldWorkingId&&reopened.receivedFrom?.id===oldWorkingId,'Reload must fork the retained original working record.');
  for(const key of ['draft','incoming','limits','workbook'])need(JSON.stringify(reopened[key])===JSON.stringify(pending[key]),'Reload changed complete '+key+'.');
  need(reopened.native.id===draftId&&reopened.native.revision===initial.native.revision,'Local recovery changed the native save reference.');
  await screen('submission-working-source-wide.png',1360);
  await page.locator('#view').selectOption('fields');await settled();
  need(await page.getByLabel('Issuer word limit',{exact:true}).inputValue()==='0.','The unfinished issuer value was coerced.');
  await page.locator('#save').click();await page.waitForFunction(()=>!document.getElementById('error').hidden);
  const originalStill=await page.evaluate(async id=>(await import('./drafts.mjs')).loadDraft(id),draftId);
  need(JSON.stringify(originalStill)===JSON.stringify(initialNative),'Incomplete limits changed the original native application.');
  await screen('submission-working-incomplete-narrow.png',390);
  const workingFile=await download('Download complete working file','complete-working.json','application/json');
  const offline=await download('Download offline editor','complete-working-editor.html','text/html;charset=utf-8');
  const nativeUrl=page.url();
  await page.goto(pathToFileURL(offline.path).href);await page.waitForFunction(()=>document.getElementById('workspace-root')?.dataset.draftId);
  await page.waitForFunction(()=>!document.getElementById('workspace-root').inert);
  need(await page.getByLabel('Issuer word limit',{exact:true}).inputValue()==='0.','Offline opening lost unfinished issuer text.');
  await screen('submission-offline-working-wide.png',1360);
  const portable=await download('Download complete working file','offline-reopened-working.json','application/json');
  const first=JSON.parse(await fs.readFile(workingFile.path,'utf8')).working,second=JSON.parse(await fs.readFile(portable.path,'utf8')).working;
  for(const key of ['draft','incoming','limits','workbook'])need(JSON.stringify(first[key])===JSON.stringify(second[key]),'Offline receiving changed complete '+key+'.');
  need(second.native.id===null&&second.native.revision===0,'Portable recovery must not target the original browser-native save.');
  await page.goto(nativeUrl);await settled();
  await page.locator('#view').selectOption('fields');
  await page.getByLabel('Issuer word limit',{exact:true}).fill(field.wordLimit===null?'':String(field.wordLimit));
  await page.locator('#view').selectOption('answers');await page.getByLabel('Draft answer',{exact:true}).fill(answer.text);
  await page.locator('#save').click();await settled();const final=await snapshot();
  need(final.native.id===draftId&&final.native.revision===initial.native.revision+1,'Explicit Save must use the original native record and revision.');
  need(final.workbook?.fields===originalSheet+'"','Native Save must not apply or drop the unfinished workbook.');
  await download('Download full draft','saved-native-draft.json','application/json');
  await download('Download complete working file','final-complete-working.json','application/json');
  await screen('submission-working-saved-narrow.png',390);
  const result={schema:'stellar-forge.grant-submission-working-receiving.v1',state:'OPERATED_AWAITING_PIXEL_INSPECTION',originalDraftId:draftId,
    native:{beforeRevision:initial.native.revision,afterRevision:final.native.revision},working:{before:oldWorkingId,after:final.id},
    files,screenshots,inspection:'Producing operator must open every actual attachment and LOOK at every exact desktop/narrow image; this function does not assert personal visual inspection.'};
  await record('working-receiving-result.json',JSON.stringify(result,null,2)+'\n','application/json');return result;
}
