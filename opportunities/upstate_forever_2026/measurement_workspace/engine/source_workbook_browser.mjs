/** Operate the existing mounted Source returns view; caller owns browser and case. */
import fs from 'node:fs';
import path from 'node:path';
import {hash} from './normalise.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
export async function operateOriginalWorkbookReturn({page,selection,edition,output}){
 need(page&&typeof page.locator==='function'&&edition?.originalWorkbooks?.length,'Use the original browser and complete saved workbook edition.');
 need(path.isAbsolute(output),'Use the original operation output directory.');
 fs.mkdirSync(output,{recursive:true});
 const ui=page.locator('.source-handback');
 await ui.waitFor({state:'visible'});
 need(await ui.locator('[data-action="reconcile"]').count()===0,'Reconcile the original pending publication before operating another selected return.');
 const files=[],images=[];
 async function download(locator,name,expected=null){
  const pending=page.waitForEvent('download',{timeout:30000});
  await locator.click();const value=await pending,file=path.join(output,name);
  need(!fs.existsSync(file),'Keep the original browser download: '+file);
  await value.saveAs(file);const raw=fs.readFileSync(file),result={path:file,bytes:raw.length,sha256:hash(raw)};
  if(expected)need(result.bytes===expected.bytes&&result.sha256===expected.sha256,'The browser download differs from the native saved member: '+name);
  files.push(result);return {raw,result};
 }
 const before=await download(ui.locator('[data-action="save-draft"]'),'source-return-before-browser.json');
 const prior=JSON.parse(before.raw);
 need(!prior.pending,'Keep the original pending request with its existing receiver.');
 for(const type of ['source','result']){
  const wanted=type==='source'?selection.sourceIds:selection.exportIds;
  for(const checkbox of await ui.locator('[data-selection="'+type+'"]').all())await checkbox.setChecked(false);
  for(const id of wanted){
   let chosen;
   for(const checkbox of await ui.locator('[data-selection="'+type+'"]').all())if(await checkbox.getAttribute('value')===id){chosen=checkbox;break;}
   need(chosen,'The actual original source/result selection is absent from this browser.');
   await chosen.setChecked(true);
  }
 }
 await ui.locator('[data-field="title"]').fill(selection.title);
 await ui.locator('[data-field="note"]').fill(selection.note);
 await ui.locator('[data-action="preview"]').click();
 await page.waitForFunction(()=>{const n=document.querySelector('.source-handback [data-action="publish"]');return n&&!n.disabled;},null,{timeout:195000});
 need((await ui.innerText()).includes('Original workbook return'),'The complete original-workbook preview is absent.');
 const working=await download(ui.locator('[data-action="save-draft"]'),'source-return-workbook-selection.json');
 const selected=JSON.parse(working.raw);
 need(JSON.stringify(selected.draft.sourceIds)===JSON.stringify(selection.sourceIds)&&JSON.stringify(selected.draft.exportIds)===JSON.stringify(selection.exportIds)&&selected.draft.title===selection.title&&selected.draft.note===selection.note,'The browser working selection changed.');
 // Native course has already retained this exact request. The browser repeats
 // that original publication; the existing publisher resolves its same identity.
 const pendingDownload=page.waitForEvent('download',{timeout:30000});
 await ui.locator('[data-action="publish"]').click();
 const pending=await pendingDownload,pendingPath=path.join(output,'original-pending-publication.json');
 need(!fs.existsSync(pendingPath),'Keep the earlier pending publication file.');
 await pending.saveAs(pendingPath);
 const pendingRaw=fs.readFileSync(pendingPath),pendingState=JSON.parse(pendingRaw);
 need(pendingState.pending?.requestFingerprint===edition.id,'The browser generated another publication; retain its original request for reconciliation.');
 files.push({path:pendingPath,bytes:pendingRaw.length,sha256:hash(pendingRaw)});
 await page.waitForFunction(id=>document.querySelector('.source-handback [data-edition]')?.value===id&&
  !document.querySelector('.source-handback [data-action="reconcile"]'),edition.id,{timeout:195000});
 await ui.locator('[data-action="edition-view"]').click();
 await page.waitForFunction(()=>document.querySelector('.source-handback')?.textContent.includes('Saved source rows are shown below'),null,{timeout:30000});
 const saved=await download(ui.locator('[data-action="manifest"]'),'browser-saved-manifest.json');
 need(JSON.stringify(JSON.parse(saved.raw))===JSON.stringify(edition),'The browser reopened a different complete edition.');
 for(const [index,workbook]of edition.originalWorkbooks.entries()){
  for(const [key,label]of [['originalPath','original'],['returnedPath','reviewed'],['lineagePath','lineage'],['partsPath','parts']]){
   const member=workbook[key];if(!member)continue;
   const button=ui.locator('[data-original-member]').filter({hasText:label==='original'?'Download original workbook':label==='reviewed'?'Download editable reviewed workbook':label==='lineage'?'Download complete worksheet lineage':'Download original part comparison'});
   // Select by exact original path, never by an ambiguous repeated file label.
   const all=await button.all();let chosen;
   for(const candidate of all)if(await candidate.getAttribute('data-original-member')===member){chosen=candidate;break;}
   need(chosen,'The exact original workbook download is unavailable.');
   await download(chosen,String(index+1)+'-'+path.basename(member),edition.files.find(x=>x.name===member));
  }
 }
 async function capture(width,height,name){
  await page.setViewportSize({width,height});
  need(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'The original return view overflows the screen.');
  const file=path.join(output,name);need(!fs.existsSync(file),'Keep the original screenshot.');
  await page.screenshot({path:file,fullPage:true});const raw=fs.readFileSync(file);images.push({path:file,bytes:raw.length,sha256:hash(raw)});
 }
 await capture(1440,1000,'original-workbook-return-desktop.png');
 await capture(390,844,'original-workbook-return-phone.png');
 const final=await download(ui.locator('[data-action="save-draft"]'),'source-return-after-browser.json');
 const finalState=JSON.parse(final.raw);
 need(finalState.selectedEditionId===edition.id&&!finalState.pending,'The browser did not retain the original completed edition.');
 // Restore the actual original operator form using its existing whole-file
 // receiver. That receiver also exports this complete displaced return state.
 const displaced=page.waitForEvent('download',{timeout:30000});
 await ui.locator('[data-draft-file]').setInputFiles(before.result.path);
 const displacedDownload=await displaced,displacedPath=path.join(output,'source-return-before-form-restoration.json');
 need(!fs.existsSync(displacedPath),'Keep the original displaced form.');
 await displacedDownload.saveAs(displacedPath);
 const displacedRaw=fs.readFileSync(displacedPath);files.push({path:displacedPath,bytes:displacedRaw.length,sha256:hash(displacedRaw)});
 await page.waitForFunction(()=>document.querySelector('.source-handback [data-status]')?.textContent.includes('Reopened the complete selection'),null,{timeout:30000});
 const restored=await download(ui.locator('[data-action="save-draft"]'),'source-return-restored-operator-form.json');
 need(JSON.stringify(JSON.parse(restored.raw))===JSON.stringify(prior),'The original operator form was not restored exactly.');
 return {editionId:edition.id,files,images,originalFormRestored:true,publicationReplayed:true,
  visualInspection:{state:'awaiting_producer_review',artifacts:[...images.map(x=>x.path),...files.map(x=>x.path)]}};
}
