// SPDX-License-Identifier: MIT
// Operates this exact outgoing review on the owner's existing Page.
import fs from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openProject,validateProject} from './project.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
export async function receiveProviderReview({page,baseUrl,applicationUrl,projectPath,outputDirectory,ownerCheck,actor}){
 need(page&&typeof ownerCheck==='function','Use the existing owned Page and required ownerCheck.');
 need(typeof actor==='string'&&actor.trim(),'Supply the actual receiving reviewer identity.');
 await ownerCheck();const originalBytes=await fs.readFile(projectPath),original=openProject(originalBytes.toString('utf8'));
 const attempt='provider-review-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
 const root=join(resolve(outputDirectory),attempt);await fs.mkdir(root,{recursive:true,mode:0o700});
 const result={schema:'tjlabs.provider-browser-receiving.v1',attempt,source:{path:resolve(projectPath),bytes:originalBytes.length,sha256:sha(originalBytes)},
  files:[],screens:[],selectedTables:[],complete:false};
 const checkpoint=async()=>{const tmp=join(root,'result.json.tmp');await fs.writeFile(tmp,JSON.stringify(result,null,2)+'\n',{mode:0o600});await fs.rename(tmp,join(root,'result.json'));};
 const retain=async(name,bytes)=>{const path=join(root,name);await fs.writeFile(path,bytes,{flag:'wx',mode:0o600});const row={path,bytes:bytes.length,sha256:sha(bytes)};result.files.push(row);await checkpoint();return row;};
 async function click(id){await ownerCheck();await page.locator('#'+id).click();await page.waitForFunction(()=>!document.querySelector('#project-file').disabled);}
 async function download(id,name){await ownerCheck();const waiting=page.waitForEvent('download');await click(id);const value=await waiting;need(!(await value.failure()),'Complete download failed: '+name);const path=join(root,name);await value.saveAs(path);const bytes=await fs.readFile(path),row={path,bytes:bytes.length,sha256:sha(bytes)};result.files.push(row);await checkpoint();return row;}
 async function tab(name){await ownerCheck();await page.locator('[data-tab="'+name+'"]').click();need(await page.locator('#'+name).isVisible(),'Selected view did not open.');}
 async function noError(){need(!(await page.locator('#error').isVisible()),'Review displayed an error: '+await page.locator('#error').textContent());}
 async function open(path){await ownerCheck();await page.locator('#project-file').setInputFiles(path);await page.waitForFunction(()=>!document.querySelector('#project-file').disabled);await noError();}
 async function screenshot(name,width){await ownerCheck();await page.setViewportSize({width,height:1000});const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));need(size.scroll<=size.width+1,'Document overflows the selected viewport.');const row=await retain(name,await page.screenshot({fullPage:true}));result.screens.push(row);await checkpoint();}
 try{
  const url=applicationUrl?new URL(applicationUrl):new URL('adaptations/airtable-netsuite/',baseUrl.endsWith('/')?baseUrl:baseUrl+'/');
  need(['http:','https:','file:'].includes(url.protocol),'Choose the original installed or complete offline review.');
  await ownerCheck();const response=await page.goto(url.href,{waitUntil:'domcontentloaded'});need(response?.ok()||(!response&&url.protocol==='file:'),'Complete review app did not open.');
  await page.waitForFunction(()=>document.documentElement.dataset.providerReviewReady==='true');
  need(await page.locator('#save').isDisabled(),'Empty editor unexpectedly contains a saved project.');
  await page.locator('#project-file').setInputFiles({name:'incomplete.json',mimeType:'application/json',buffer:Buffer.from('{"schema":"tjlabs.provider-migration-project.v1"}')});
  await page.waitForFunction(()=>!document.querySelector('#project-file').disabled);need(await page.locator('#error').isVisible(),'Invalid original project did not produce a visible recoverable error.');
  await open(projectPath);
  const saved=await download('save','original-project.json');need(JSON.stringify(openProject(await fs.readFile(saved.path,'utf8')))===JSON.stringify(original),'Opening and saving changed the complete original project.');
  await tab('mapping');await page.locator('#mapping-editor').fill('{"unfinished":');
  const unfinished=await download('save-working','unfinished-working.json');const unfinishedBody=JSON.parse(await fs.readFile(unfinished.path,'utf8'));
  need(unfinishedBody.mappingText==='{"unfinished":'&&JSON.stringify(unfinishedBody.project)===JSON.stringify(original),'Unfinished file lost source or raw editor text.');
  await click('preview');need(await page.locator('#error').isVisible(),'Invalid mapping preview did not show its error.');
  await click('restore-mapping');await open(unfinished.path);need(await page.locator('#mapping-editor').inputValue()==='{"unfinished":','Working file did not restore exact invalid mapping text.');
  await click('restore-mapping');await open(projectPath);await click('preview');await noError();
  await page.locator('#actor').fill(actor.trim());
  await page.locator('#reason').fill('Reopened complete original source and mapping in the selected receiving application; retain this exact edition.');
  await page.locator('#approve').check();await click('apply');await noError();
  const finalProject=await download('save','reviewed-project.json'),reviewed=openProject(await fs.readFile(finalProject.path,'utf8'));
  need(reviewed.id===original.id&&reviewed.captureSha256===original.captureSha256&&JSON.stringify(reviewed.capture)===JSON.stringify(original.capture)&&
    reviewed.revision===original.revision+1&&reviewed.approval,'The reviewed edition lost its original source or attributed history.');
  need(JSON.stringify(reviewed.history.slice(0,original.history.length))===JSON.stringify(original.history),'Original review history changed.');
  await open(finalProject.path);const repeated=await download('save','reopened-reviewed-project.json');
  need((await fs.readFile(repeated.path)).equals(await fs.readFile(finalProject.path)),'Complete reviewed project changed after reopen.');
  const packetFile=await download('export','provider-prepared-source.json'),packet=JSON.parse(await fs.readFile(packetFile.path,'utf8'));
  need(packet.projectId===reviewed.id&&packet.revision===reviewed.revision&&Array.isArray(packet.files),'Complete prepared source selects another edition.');
  const extracted=join(root,'prepared');await fs.mkdir(extracted,{mode:0o700});
  for(const f of packet.files){need(typeof f.path==='string'&&!f.path.startsWith('/')&&!f.path.includes('\\')&&f.path.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Unsafe prepared source path.');
   const b=Buffer.from(f.content,'utf8');need(b.length===f.bytes&&sha(b)===f.sha256,'Complete prepared member changed: '+f.path);
   const path=join(extracted,f.path);await fs.mkdir(join(path,'..'),{recursive:true,mode:0o700});await fs.writeFile(path,b,{flag:'wx',mode:0o600});}
  need(JSON.stringify(openProject(await fs.readFile(join(extracted,'review/project.json'),'utf8')))===JSON.stringify(reviewed),'Extracted complete project differs.');
  await open(join(extracted,'review/project.json'));
  await tab('population');
  const names=await page.locator('#table option').evaluateAll(nodes=>nodes.map(n=>n.value));
  need(names.length===packet.manifest.tables.length,'Selected table controls omit an original table.');
  for(const name of names){await ownerCheck();await page.locator('#table').selectOption(name);const table=packet.manifest.tables.find(x=>x.name===name);
   for(const side of ['source','expected']){await page.locator('#side').selectOption(side);const f=packet.files.find(x=>x.path===(side==='source'?table.sourcePath:table.expectedPath));
    const row=await download('download-table',name+'-'+side+'.json');need((await fs.readFile(row.path)).equals(Buffer.from(f.content,'utf8')),'Selected full table download differs.');
    if((side==='source'?table.sourceRows:table.expectedRows)>100){await click('next');need((await page.locator('#row-count').textContent()).includes('101'),'Complete table paging did not advance.');await click('prev');}}
   result.selectedTables.push(name);}
  await page.locator('#query').fill('__receiving_no_match__');need((await page.locator('#row-count').textContent()).startsWith('No matching rows'),'Search empty state missing.');await page.locator('#query').fill('');
  for(const name of ['mapping','population','sources','history','native']){await tab(name);for(const width of [1440,390])await screenshot(name+'-'+width+'.png',width);}
  await tab('sources');const buttons=page.locator('#source-list button');need(await buttons.count()===packet.manifest.files.length,'Original source list is incomplete.');
  for(let i=0;i<packet.manifest.files.length;i++){await ownerCheck();const waiting=page.waitForEvent('download');await buttons.nth(i).click();const d=await waiting;need(!(await d.failure()),'Original source file failed.');const f=packet.manifest.files[i],path=join(root,'source-'+i+'.json');await d.saveAs(path);const b=await fs.readFile(path);need(b.length===f.bytes&&sha(b)===f.sha256,'Original source download differs: '+f.path);result.files.push({path,bytes:b.length,sha256:sha(b)});}
  result.reviewedProject=finalProject;result.prepared=packetFile;result.complete=true;await checkpoint();return result;
 }catch(e){result.error=e.message;await checkpoint();e.receivingResult=result;throw e;}
}
