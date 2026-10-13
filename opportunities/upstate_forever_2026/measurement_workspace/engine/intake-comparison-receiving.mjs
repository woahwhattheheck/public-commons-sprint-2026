/** Read-only continuation of the ORIGINAL completed guided-intake course.
 * Caller owns the existing Page, server, workspace and lifetime lock; starts none.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {reopenIntakeComparison} from './intake.mjs';
import {stable} from './normalise.mjs';
const activePages=new WeakSet(),sha=x=>createHash('sha256').update(x).digest('hex');
const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
const sourcePaths=['measurement_workspace/engine/intake-comparison-receiving.mjs','measurement_workspace/engine/intake_comparison.mjs','measurement_workspace/engine/intake.mjs','measurement_workspace/engine/parse.mjs','measurement_workspace/engine/normalise.mjs','measurement_workspace/engine/characteristics.mjs','measurement_workspace/engine/source_lineage.mjs','measurement_workspace/engine/http.mjs','measurement_workspace/engine/cli.mjs','measurement_workspace/web/intake.mjs','measurement_workspace/web/intake_comparison.mjs','operator/web/measured_intake.mjs','operator/web/intake_comparison.mjs'];
const bytes=value=>Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
async function syncDirectory(directory){const h=await fs.open(directory,'r');try{await h.sync();}finally{await h.close();}}
async function durableDirectory(directory){
 try{const st=await fs.lstat(directory);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Use an owned real output directory: '+directory);await syncDirectory(directory);await syncDirectory(path.dirname(directory));return;}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const parent=path.dirname(directory);if(parent===directory)throw Error('Missing output root');await durableDirectory(parent);
 try{await fs.mkdir(directory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 const st=await fs.lstat(directory);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Output directory changed');
 await syncDirectory(directory);await syncDirectory(parent);
}
async function exact(file,value){
 const b=bytes(value),temporary=file+'.complete-'+randomUUID();let h;
 try{
  h=await fs.open(temporary,'wx',0o600);await h.writeFile(b);await h.sync();await h.close();h=null;
  try{await fs.link(temporary,file);}catch(e){if(e.code!=='EEXIST')throw e;const st=await fs.lstat(file);assert(st.isFile()&&!st.isSymbolicLink(),'Output must be an original regular file');assert.deepEqual(await fs.readFile(file),b,'Original retained selection changed: '+file);h=await fs.open(file,'r');await h.sync();await h.close();h=null;}
  await syncDirectory(path.dirname(file));await fs.unlink(temporary);await syncDirectory(path.dirname(file));
  return {path:path.basename(file),bytes:b.length,sha256:sha(b)};
 }finally{await h?.close();}
}
async function sourceIdentity(){return Promise.all(sourcePaths.map(async name=>{const b=await fs.readFile(path.join(sourceRoot,name));return {path:name,bytes:b.length,sha256:sha(b)};}));}
const comparable=value=>({...value,createdAt:''});
export async function operateIntakeComparison({page,endpoint,preparationId,directory,beforeRevision,afterRevision,apiBase='/api/measurement-workspace',timeout=120000}={}){
 if(!page||!endpoint||!preparationId||!directory)throw Error('Supply the original Page, endpoint, preparation and owned output directory.');
 if(activePages.has(page))throw Error('The original comparison continuation is already active on this Page.');
 if(!Number.isSafeInteger(timeout)||timeout<1000)throw Error('Use a positive supported wait.');
 activePages.add(page);let offline;const files=[],errors=[];let attempt;
 const onError=e=>errors.push(String(e));page.on('pageerror',onError);
 try{
  const root=path.resolve(directory);await durableDirectory(root);
  const api=async suffix=>{const response=await page.context().request.get(endpoint.replace(/\/$/,'')+apiBase+suffix,{timeout});assert(response.ok(),'Original API read failed '+response.status()+' '+suffix);return response.json();};
  const sources=await sourceIdentity(),history=await api('/intake/'+encodeURIComponent(preparationId)+'/comparison-history');
  const editions=history.project.editions;assert(editions.length>=2,'Continue the original preparation with its existing two saved revisions.');
  beforeRevision??=editions[0].revision;afterRevision??=editions.at(-1).revision;
  const selectedBefore=editions.find(e=>e.revision===beforeRevision),selectedAfter=editions.find(e=>e.revision===afterRevision);
  assert(selectedBefore&&selectedAfter&&beforeRevision!==afterRevision,'Select two actual saved revisions.');
  assert.equal(selectedBefore.value.sourceSha,selectedAfter.value.sourceSha,'Use the same original source bytes.');
  assert.equal(selectedBefore.value.kind,selectedAfter.value.kind,'Use the same original source type.');
  const intent={operation:'ECO-INTAKE-INTERPRETATION-COMPARISON-9F05-20261013',endpoint,apiBase,workspaceId:history.project.workspaceId,preparationId,beforeRevision,afterRevision,historySha:history.historySha,sources};
  await exact(path.join(root,'selection.json'),intent);
  // Every retry observes the actual store, never only an old export.
  const before=await api('/portable');await exact(path.join(root,'original-workspace.json'),comparable(before));
  attempt=path.join(root,'attempt-'+Date.now()+'-'+randomUUID());await durableDirectory(attempt);
  const keep=async(name,value)=>{const item=await exact(path.join(attempt,name),value);files.push(item);return path.join(attempt,name);};
  await keep('original-selection.json',intent);await keep('preparation-history.json',history);await keep('actual-workspace-before.json',before);
  // Preserve the live page and unfinished controls; selection uses original protected Open.
  assert.equal(new URL(page.url()).origin,new URL(endpoint).origin,'Operate the already-open original application.');
  const box=page.locator('.mi');await box.locator('[data-select]').waitFor({timeout});
  if(await box.locator('[data-select]').inputValue()!==preparationId)await box.locator('[data-select]').selectOption(preparationId);
  const panel=box.locator('.intake-comparison');
  await panel.locator('[data-ic-action="history"]').click({timeout});
  await panel.locator('[data-ic-status]').filter({hasText:'Complete saved history loaded'}).waitFor({timeout});
  await panel.locator('[data-ic-before]').selectOption(String(beforeRevision));
  await panel.locator('[data-ic-after]').selectOption(String(afterRevision));
  await panel.locator('[data-ic-action="compare"]').click();
  await panel.locator('[data-ic-status]').filter({hasText:'Every original row compared'}).waitFor({timeout});
  async function downloaded(owner,locator,name){
   const [d]=await Promise.all([owner.waitForEvent('download',{timeout}),locator.click({timeout})]);
   const failure=await d.failure();if(failure)throw Error('Original download failed: '+failure);
   const temporary=path.join(attempt,'incoming-'+randomUUID());await d.saveAs(temporary);
   const b=await fs.readFile(temporary),target=await keep(name,b);await fs.unlink(temporary);await syncDirectory(attempt);return {path:target,bytes:b};
  }
  const complete=await downloaded(page,panel.locator('[data-ic-action="json"]'),'complete-comparison.json');
  const report=JSON.parse(complete.bytes.toString('utf8'));assert.equal(stable(reopenIntakeComparison(report)),stable(report));
  assert.equal(report.workspaceId,intent.workspaceId);assert.equal(report.before.id,preparationId);assert.equal(report.before.revision,beforeRevision);assert.equal(report.after.revision,afterRevision);
  assert.equal(stable(report.project),stable(history.project),'Browser report must retain exact complete history.');
  const html=await downloaded(page,panel.locator('[data-ic-action="html"]'),'comparison.html');
  const original=await downloaded(page,panel.locator('[data-ic-action="original"]'),'original-source.txt');assert.equal(sha(original.bytes),report.before.sourceSha);
  const preparation=await downloaded(page,panel.locator('[data-ic-action="preparation"]'),'complete-preparation.json');
  assert.equal(stable(JSON.parse(preparation.bytes.toString('utf8'))),stable(history.project));
  const viewport=page.viewportSize();
  try{for(const width of [1365,390]){await page.setViewportSize({width,height:900});await keep('comparison-'+width+'.png',await page.screenshot({fullPage:true}));if(width===390)assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Document overflows at390px.');}}
  finally{if(viewport)await page.setViewportSize(viewport);}
  await panel.locator('[data-ic-open]').setInputFiles(complete.path);
  await panel.locator('[data-ic-status]').filter({hasText:'Complete original history, both interpretations'}).waitFor({timeout});
  const reopened=await downloaded(page,panel.locator('[data-ic-action="json"]'),'reopened-comparison.json');assert.deepEqual(reopened.bytes,complete.bytes);
  offline=await page.context().newPage();offline.on('pageerror',onError);
  await offline.goto(pathToFileURL(html.path).href,{timeout});await offline.locator('#comparison-body table').first().waitFor({timeout});
  await offline.setViewportSize({width:390,height:844});await keep('offline-comparison-390.png',await offline.screenshot({fullPage:true}));
  assert(await offline.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Offline comparison overflows at390px.');
  const cold=await downloaded(offline,offline.locator('[data-export="comparison"]'),'offline-comparison.json');assert.deepEqual(cold.bytes,complete.bytes);
  const coldSource=await downloaded(offline,offline.locator('[data-export="original"]'),'offline-original.txt');assert.deepEqual(coldSource.bytes,original.bytes);
  const coldProject=await downloaded(offline,offline.locator('[data-export="preparation"]'),'offline-preparation.json');assert.equal(stable(JSON.parse(coldProject.bytes.toString('utf8'))),stable(history.project));
  const after=await api('/portable');await keep('actual-workspace-after.json',after);
  assert.equal(stable(comparable(after)),stable(comparable(before)),'Read-only comparison changed the actual native store.');
  assert.deepEqual(await sourceIdentity(),sources,'Original source changed during the continuation.');assert.deepEqual(errors,[]);
  const result={...intent,status:'COMPLETE',attempt,completedAt:new Date().toISOString(),reportSha256:report.sha256,summary:report.summary,files,errors,visualReview:'Desktop/390px and standalone outputs captured. Original operator must LOOK at images and attachments before claiming rendered acceptance.'};
  await exact(path.join(attempt,'COMPLETE.json'),result);return result;
 }catch(e){if(attempt)await exact(path.join(attempt,'INTERRUPTED.json'),{at:new Date().toISOString(),name:e.name,message:e.message,files,errors});throw e;}
 finally{await offline?.close();page.off('pageerror',onError);activePages.delete(page);}
}
