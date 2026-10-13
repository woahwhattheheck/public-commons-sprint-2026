/** Named-rehearsal continuation of the one original migration receiving course.
 * It uses an isolated, explicitly illustrative copy and unchanged original engines. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as E from './engine.mjs';
import * as R from './migration-rehearsals.mjs';
import {illustrativeWorkspace} from './asset-crosswalk-receiving.mjs';
const need=(v,m)=>{if(!v)throw Error(m);},hash=b=>createHash('sha256').update(b).digest('hex');
function unzip(bytes){
 const files=new Map();let offset=0;
 while(offset+30<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
  const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8),size=bytes.readUInt32LE(offset+18),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+n+extra;
  need(!(flags&8)&&method===0&&start+size<=bytes.length,'Retain the original complete stored ZIP.');
  const name=bytes.subarray(offset+30,offset+30+n).toString('utf8');
  need(!files.has(name)&&!name.startsWith('/')&&!name.includes('\\')&&!name.split('/').some(p=>p==='..'||!p),'Unsafe or duplicate archive member.');
  files.set(name,bytes.subarray(start,start+size));offset=start+size;
 }
 need(offset+4<=bytes.length&&bytes.readUInt32LE(offset)===0x02014b50,'Retain the complete archive directory.');return files;
}
async function viewer(){
 const files=new Map(),prefix='/retained/'+randomUUID()+'/',server=createServer(async(req,res)=>{
  try{if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
   const name=new URL(req.url,'http://127.0.0.1').pathname;if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
   const file=files.get(name);if(!file){res.writeHead(404);res.end();return;}
   const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
 return {add(file){const name=prefix+randomUUID()+'.html';files.set(name,file);return 'http://127.0.0.1:'+server.address().port+name;},close:()=>new Promise((ok,no)=>server.close(e=>e?no(e):ok()))};
}
export async function runRehearsalReceiving({context,outputDirectory,applicationPath}){
 need(path.isAbsolute(outputDirectory)&&path.isAbsolute(applicationPath),'Use the original absolute receiving paths.');
 const browser=context.browser();need(browser,'Use the existing receiving browser.');
 const original=await fs.readFile(applicationPath),html=original.toString('utf8'),match=/<script id="bootstrap" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
 need(match,'Retain the complete original application bootstrap.');const boot=JSON.parse(match[1]);
 need(boot.migrationRehearsalsSource&&boot.migrationRehearsalsUISource,'Install the complete named-rehearsal application.');
 const ws=illustrativeWorkspace(),baseline=E.exportWorkspace(ws),root=path.join(outputDirectory,'migration-rehearsals-'+randomUUID());await fs.mkdir(root,{recursive:true});
 const app=path.join(root,'Rehearsal_Receiving.html'),incoming={...boot,copyId:randomUUID(),portable:baseline,drafts:{},recovery:null};
 await fs.writeFile(app,html.replace(match[0],'<script id="bootstrap" type="application/json">'+JSON.stringify(incoming).replaceAll('<','\\u003c')+'</script>'),{flag:'wx'});
 const local=await viewer(),own=await browser.newContext({acceptDownloads:true}),page=await own.newPage(),errors=[],outputs=[],screenshots=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const nav=name=>page.locator('[data-tab="'+name+'"]').click();
 async function download(selector,name){const pending=page.waitForEvent('download');await page.locator(selector).click();const item=await pending,file=path.join(root,name||item.suggestedFilename());await item.saveAs(file);const bytes=await fs.readFile(file);outputs.push({path:file,bytes:bytes.length,sha256:hash(bytes)});return{file,bytes};}
 async function state(name){return E.importWorkspace((await download('#top-json',name)).bytes.toString('utf8'));}
 async function view(name){for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});const file=path.join(root,name+'-'+width+'.png');await page.screenshot({path:file,fullPage:true});screenshots.push(file);}await page.setViewportSize({width:1440,height:1000});}
 async function save(label,reference,note){
  await page.locator('#rh-label').fill(label);await page.locator('#rh-actor').fill('Illustrative receiving reviewer');await page.locator('#rh-reference').fill(reference);await page.locator('#rh-note').fill(note);
  const revision=Number((await page.locator('header').innerText()).match(/Revision (\d+)/)[1]);await page.locator('#rh-save').click();
  await page.waitForFunction(n=>document.querySelector('header').innerText.includes('Revision '+n+' ·'),revision+1);
 }
 try{
  await page.goto(local.add(app));await nav('rehearsals');await page.locator('#rh-save').waitFor();
  await page.locator('#rh-note').fill('Unfinished named review retained in a working HTML');
  const unfinished=await download('#top-save','unfinished-rehearsal-working.html');
  const reopened=await own.newPage();try{await reopened.goto(local.add(unfinished.file));await reopened.locator('[data-tab="rehearsals"]').click();need(await reopened.locator('#rh-note').inputValue()==='Unfinished named review retained in a working HTML','The working HTML lost the unfinished review.');}finally{await reopened.close();}
  await save('Illustrative first returned edition','Illustrative actual round one files','Retain the complete original mapped source and returned observations.');
  const first=await state('first-named-rehearsal.json'),firstEdition=R.list(first).editions[0];need(firstEdition.revision===ws.revision,'The first edition captured another revision.');
  await view('01-first-named-observation');
  const target=ws.sources.find(s=>s.role==='target'&&s.domain==='balances'),row=target.rows[0],column=E.DOMAINS.balances.fields.findIndex(f=>f.name==='amount');
  await nav('sources');await page.locator('#domain').selectOption('balances');await page.locator('#role').selectOption('target');await page.locator('[data-row="'+row.id+'"]').click();await page.locator('#column').selectOption(String(column));
  await page.locator('#value').fill('9007199254740993.123456789012345679');await page.locator('#reason').fill('Illustrative one18th-decimal change for exact historical comparison');await page.locator('#actor').fill('Illustrative receiving reviewer');await page.locator('#correct').click();
  await page.waitForFunction(n=>document.querySelector('header').innerText.includes('Revision '+n+' ·'),first.revision+1);
  await nav('rehearsals');await page.locator('#rh-current').click();
  await save('Illustrative second returned edition','Illustrative actual round two correction','Retain the exact changed amount and all original source bytes.');
  const finalWS=await state('second-named-rehearsal.json'),history=R.list(finalWS),last=history.editions.at(-1),comparison=R.compare(finalWS,firstEdition.id,last.id);
  need(history.editions.length===2&&comparison.summary.changed===1,'The named comparison must retain exactly one actual changed row.');
  const change=comparison.families.find(f=>f.family==='finance/target/balances').rows.find(r=>r.state==='CHANGED');
  need(change.monetary.find(m=>m.field==='amount').delta==='0.000000000000000001','The exact historical decimal changed.');
  need(JSON.stringify(finalWS.sources)===JSON.stringify(ws.sources),'The review modified original source files.');
  await page.locator('#rh-before').selectOption(firstEdition.id);await page.locator('#rh-after').selectOption(last.id);await view('02-original-revision-comparison');
  const selected={before:firstEdition.id,after:last.id},expected=R.exportFiles(finalWS,selected);
  for(const [selector,name,pathName]of [['#rh-report','rehearsal-report.html','rehearsals/report.html'],['#rh-json','rehearsal-review.json','rehearsals/review.json'],['#rh-csv','rehearsal-rows.csv','rehearsals/rows.csv'],['#rh-history','rehearsal-history.json','rehearsals/history.json']]){
   const downloaded=await download(selector,name),file=expected.files.find(f=>f.path===pathName);need(downloaded.bytes.equals(Buffer.from(file.text)),'The complete actual review download changed: '+name);
   if(name.endsWith('.html')){const report=await own.newPage();try{await report.goto(local.add(downloaded.file));await report.getByRole('heading',{name:'Migration rehearsal comparison',exact:true}).waitFor();const image=path.join(root,'03-complete-downloaded-report.png');await report.screenshot({path:image,fullPage:true});screenshots.push(image);}finally{await report.close();}}
  }
  await page.locator('#rh-before').selectOption('');await page.locator('#rh-after').selectOption(firstEdition.id);
  const historical=await download('#rh-workspace','first-original-historical-workspace.json');need(E.exportWorkspace(E.importWorkspace(historical.bytes.toString('utf8')))===baseline,'Historical workspace recovery changed the original operation prefix.');
  await nav('handover');await page.locator('#prepare-handover').click();const archive=await download('#zip','named-rehearsal-complete-handover.zip'),members=unzip(archive.bytes),manifest=JSON.parse(members.get('MANIFEST.json'));
  need(members.size===manifest.files.length+1,'The full archive manifest omits or adds a member.');
  for(const f of manifest.files){const body=members.get(f.path);need(body&&body.length===f.bytes&&hash(body)===f.sha256,'An original outgoing member changed: '+f.path);}
  need(E.exportWorkspace(E.importWorkspace(members.get('workspace.json').toString('utf8')))===E.exportWorkspace(finalWS),'The handover changed original named observations.');
  for(const f of boot.applicationSource.files)need(members.get('application/'+f.path)?.equals(Buffer.from(f.text)),'The complete application source lost '+f.path);
  for(const f of expected.files)need(members.get(f.path)?.equals(Buffer.from(f.text)),'The full handover lost an original review member.');
  const extracted=path.join(root,'received');for(const [name,body]of members){const dest=path.resolve(extracted,name);need(dest.startsWith(extracted+path.sep),'Unsafe received path.');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,body,{flag:'wx'});}
  const copied=path.join(extracted,'application/services/fixed-asset-migration'),portable=path.join(extracted,'workspace.json');
  const inspected=JSON.parse(execFileSync(process.execPath,[path.join(copied,'cli.mjs'),'rehearsal-compare','--workspace',portable,'--before',firstEdition.id,'--after',last.id],{encoding:'utf8',maxBuffer:64*1024*1024}));
  need(JSON.stringify(inspected)===JSON.stringify(comparison),'The copied application changed the complete frozen comparison.');
  const cliDirectory=path.join(root,'cli-handover'),cliResult=JSON.parse(execFileSync(process.execPath,[path.join(copied,'cli.mjs'),'handover','--workspace',portable,'--out',cliDirectory],{encoding:'utf8',maxBuffer:64*1024*1024}));
  for(const f of cliResult.files){const body=await fs.readFile(path.join(cliDirectory,f.path));need(body.length===f.bytes&&hash(body)===f.sha256,'A copied CLI handover member changed: '+f.path);}
  const cold=await browser.newContext({acceptDownloads:true}),opened=await cold.newPage();opened.on('pageerror',e=>errors.push(String(e)));
  try{await opened.goto(local.add(path.join(cliDirectory,'Fixed_Asset_Finance_Workspace.html')));await opened.locator('[data-tab="rehearsals"]').click();await opened.locator('#rh-before').selectOption(firstEdition.id);await opened.locator('#rh-after').selectOption(last.id);await opened.getByText('After − before = 0.000000000000000001',{exact:false}).first().waitFor();
   for(const width of [1440,390]){await opened.setViewportSize({width,height:width===390?844:1000});const image=path.join(root,'04-cold-rehearsal-'+width+'.png');await opened.screenshot({path:image,fullPage:true});screenshots.push(image);}
   const pending=opened.waitForEvent('download');await opened.locator('#top-json').click();const item=await pending,file=path.join(root,'cold-rehearsal-workspace.json');await item.saveAs(file);need(E.exportWorkspace(E.importWorkspace(await fs.readFile(file,'utf8')))===E.exportWorkspace(finalWS),'The cold application changed original history.');
  }finally{await cold.close();}
  need(errors.length===0,'The actual rehearsal browser reported: '+errors.join('; '));
  const result={schema:'tjlabs.migration-rehearsal-receiving.v1',application:{path:applicationPath,bytes:original.length,sha256:hash(original)},sourceMeaning:'Explicitly illustrative finance inputs, not Port tenant records.',workspaceId:finalWS.id,revision:finalWS.revision,head:history.head,editions:history.editions.map(r=>({id:r.id,revision:r.revision,evidence_sha256:r.evidence_sha256})),exactDelta:'0.000000000000000001',originalValuesUnchanged:true,outputs,screenshots,cliHandover:cliDirectory,pageErrors:errors,producerView:'The producing owner opens and LOOKS at the actual application, desktop/narrow screens, all downloaded HTML/CSV/JSON, complete archives and copied application, then records the actual viewed edition.'};
  await fs.writeFile(path.join(root,'migration-rehearsal-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
 }finally{await own.close();await local.close();}
}
