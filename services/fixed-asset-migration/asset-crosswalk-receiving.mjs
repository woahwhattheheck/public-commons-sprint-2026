/** Companion of the one original finance/browser receiving course.
 * All migration data below are expressly illustrative, never Port tenant data. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as E from './engine.mjs';
import * as X from './asset-crosswalk.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function illustrativeWorkspace(){
 let ws=E.createWorkspace({id:'illustrative-asset-crosswalk',title:'Illustrative renamed asset and ledger identities',createdAt:'2026-10-13T19:00:00Z'}),n=0;
 const meta=()=>({operationId:'crosswalk-example-'+(++n),expectedRevision:ws.revision,at:'2026-10-13T19:00:00Z'});
 for(const role of ['source','target'])for(const domain of ['assets','books','balances','events','journals','controls']){
  const company=role==='source'?'C':'D',book=role==='source'?'BOOK':'LEDGER',asset=role==='source'?'A':'T',parent=role==='source'?'P':'Q';
  const data={
   assets:[[company,parent,'','Plant','Parent'],[company,asset,parent,'Equipment','Child']],
   books:[[company,book,'USD','original']],
   balances:[[company,book,asset,'2026-01-01','USD','cost','9007199254740993.123456789012345678'],[company,book,asset,'2026-12-31','USD','cost','9007199254740994.123456789012345678']],
   events:[[company,book,asset,'event-'+role,'2026-02-01','USD','cost','1','addition']],
   journals:[[company,book,'journal-'+role,'1','2026-02-01','USD','asset','1','0',asset],[company,book,'journal-'+role,'2','2026-02-01','USD','contra','0','1','']],
   controls:[[company,book,'2026-01-01','USD','cost','9007199254740993.123456789012345678','independent'],[company,book,'2026-12-31','USD','cost','9007199254740994.123456789012345678','independent']]
  },columns=E.DOMAINS[domain].fields.map(f=>f.name);
  const imported=E.importCsv(ws,{...meta(),role,domain,filename:role+'-'+domain+'.csv',text:E.encodeCsv([columns,...data[domain]])});ws=imported.workspace;
  ws=E.saveMapping(ws,{...meta(),sourceId:imported.receipt.result.sourceId,role,domain,columns:Object.fromEntries(columns.map((c,i)=>[c,i])),amount_multiplier:1}).workspace;
 }
 for(const role of ['source','target'])ws=E.saveFinancePolicy(ws,{...meta(),policy:{id:'policy-'+role,company_id:role==='source'?'C':'D',book_id:role==='source'?'BOOK':'LEDGER',currency:'USD',opening_date:'2026-01-01',closing_date:'2026-12-31',event_scope_complete:true,population_complete:true,rollforward_measures:['cost'],carrying_equations:[],actor:'Illustrative operator',note:'Explicit complete illustrative original populations; not Port tenant data.'}}).workspace;
 return ws;
}
function unzip(bytes){
 const files=new Map();let offset=0;
 while(offset+30<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
  const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8),size=bytes.readUInt32LE(offset+18),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+n+extra;
  need(!(flags&8)&&method===0&&start+size<=bytes.length,'Retain the complete original stored ZIP.');
  const name=bytes.subarray(offset+30,offset+30+n).toString('utf8');
  need(!files.has(name)&&!name.startsWith('/')&&!name.includes('\\')&&!name.split('/').some(p=>p==='..'||!p),'Unsafe or duplicate archive member.');
  files.set(name,bytes.subarray(start,start+size));offset=start+size;
 }
 need(offset+4<=bytes.length&&bytes.readUInt32LE(offset)===0x02014b50,'The complete archive directory is missing.');return files;
}
export async function runAssetCrosswalkReceiving({context,outputDirectory,applicationPath}){
 need(path.isAbsolute(outputDirectory)&&path.isAbsolute(applicationPath),'Use the original absolute receiving paths.');
 const browser=context.browser();need(browser,'Use the existing original receiving browser.');
 const original=await fs.readFile(applicationPath),html=original.toString('utf8'),match=/<script id="bootstrap" type="application\/json">([\s\S]*?)<\/script>/.exec(html);need(match,'Retain the full original application bootstrap.');
 const boot=JSON.parse(match[1]);need(boot.assetCrosswalkSource&&boot.assetCrosswalkUISource,'Install the complete current crosswalk application.');
 const ws=illustrativeWorkspace(),baseline=E.exportWorkspace(ws),root=path.join(outputDirectory,'asset-crosswalk-'+randomUUID());await fs.mkdir(root,{recursive:true});
 const app=path.join(root,'Asset_Crosswalk_Receiving.html'),incoming={...boot,copyId:randomUUID(),portable:baseline,drafts:{},recovery:null};
 await fs.writeFile(app,html.replace(match[0],'<script id="bootstrap" type="application/json">'+JSON.stringify(incoming).replaceAll('<','\\u003c')+'</script>'),{flag:'wx'});
 const own=await browser.newContext({acceptDownloads:true}),page=await own.newPage(),errors=[],outputs=[],screenshots=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const nav=name=>page.locator('[data-tab="'+name+'"]').click();
 async function download(selector,name){const wait=page.waitForEvent('download');await page.locator(selector).click();const item=await wait,file=path.join(root,name||item.suggestedFilename());await item.saveAs(file);const bytes=await fs.readFile(file);outputs.push({path:file,bytes:bytes.length,sha256:hash(bytes)});return{file,bytes};}
 async function state(name){return E.importWorkspace((await download('#top-json',name)).bytes.toString('utf8'));}
 async function view(name){for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});const file=path.join(root,name+'-'+width+'.png');await page.screenshot({path:file,fullPage:true});screenshots.push(file);}await page.setViewportSize({width:1440,height:1000});}
 const originalReport=X.reconcile(ws),pairs=['assets','books'].flatMap(domain=>originalReport.choices.source[domain].map((r,i)=>({domain,sourceRowId:r.rowId,targetRowId:originalReport.choices.target[domain][i].rowId})));
 async function link(p){await page.locator('#ax-domain').selectOption(p.domain);await page.locator('[data-ax-row="'+p.sourceRowId+'"]').click();await page.locator('#ax-target').selectOption(p.targetRowId);await page.locator('#ax-link').click();}
 async function save(reason){await page.locator('#ax-actor').fill('Receiving operator');await page.locator('#ax-reason').fill(reason);const before=(await page.locator('header').innerText()).match(/Revision (\d+)/);await page.locator('#ax-save').click();await page.waitForFunction(n=>document.querySelector('header').innerText.includes('Revision '+n+' ·'),Number(before[1])+1);}
 try{
  await page.goto(pathToFileURL(app).href);await nav('crosswalk');await page.locator('#ax-save').waitFor();await view('01-unlinked-originals');
  for(const p of pairs)await link(p);
  await page.locator('#ax-actor').fill('Receiving operator');await page.locator('#ax-reason').fill('Unfinished original correspondence retained before save');
  const unfinished=await download('#top-save','unfinished-crosswalk-working.html');
  const reopened=await own.newPage();try{await reopened.goto(pathToFileURL(unfinished.file).href);await reopened.locator('[data-tab="crosswalk"]').click();need(await reopened.locator('#ax-reason').inputValue()==='Unfinished original correspondence retained before save','The saved working HTML lost its unfinished decision.');}finally{await reopened.close();}
  await save('Confirmed actual returned company/book/asset IDs and original parent links');
  const first=await state('crosswalk-first-edition.json');need(X.read(first).history.length===1&&X.reconcile(first).basisCurrent&&!X.reconcile(first).independentFinancial.confirmed,'Saving correspondence must retain one current edition and require the original financial basis review.');
  await view('02-saved-identity-and-stale-financial-basis');
  const child=pairs.find(p=>p.domain==='assets'&&p.sourceRowId.endsWith(':r3'));
  await page.locator('#ax-domain').selectOption('assets');await page.locator('[data-ax-row="'+child.sourceRowId+'"]').click();await page.locator('#ax-unlink').click();await save('Temporary explicit withdrawal to inspect unresolved original population');
  const withdrawn=await state('crosswalk-withdrawn-edition.json');need(X.read(withdrawn).history.length===2&&!X.reconcile(withdrawn).ready&&X.reconcile(withdrawn).coverage.some(r=>r.state==='UNLINKED'),'Withdrawal concealed the original unresolved rows.');
  await link(child);await save('Restored reviewed original child correspondence; retain withdrawal history');
  await nav('policy');
  for(const role of ['source','target']){await page.locator('#policy-select').selectOption('policy-'+role);await page.locator('#confirm-policy').check();await page.locator('#save-policy').click();await page.getByText(/Saved revision|is in memory/).first().waitFor();}
  const finalWS=await state('crosswalk-final-workspace.json'),r=X.reconcile(finalWS);
  need(r.ready&&r.history.length===3&&r.balances.every(x=>x.difference==='0')&&r.events.every(x=>x.difference==='0'),'The exact reviewed mapped financial course did not reconcile.');
  need(r.balances[0].source==='9007199254740993.123456789012345678'&&r.independentFinancial.journals.length===2&&!E.reconcile(finalWS).ready,'The exact amount, independent journal identities or literal-ID comparison changed.');
  need(JSON.stringify(finalWS.sources)===JSON.stringify(ws.sources)&&finalWS.corrections.length===0,'Identity correspondence modified original source values.');
  await nav('crosswalk');await view('03-final-mapped-reconciliation');
  for(const [selector,name,pathName]of [['#ax-report','asset-crosswalk-report.html','asset-crosswalk/report.html'],['#ax-json','asset-crosswalk-reconciliation.json','asset-crosswalk/reconciliation.json'],['#ax-links','asset-crosswalk-correspondences.csv','asset-crosswalk/correspondences.csv']]){
   const f=await download(selector,name),expected=X.exportFiles(finalWS).files.find(x=>x.path===pathName);need(f.bytes.equals(Buffer.from(expected.text)),'Actual crosswalk download differs: '+name);
   if(name.endsWith('.html')){const reportPage=await own.newPage();try{await reportPage.goto(pathToFileURL(f.file).href);await reportPage.getByRole('heading',{name:'Asset identity crosswalk',exact:true}).waitFor();const image=path.join(root,'04-downloaded-crosswalk-report.png');await reportPage.screenshot({path:image,fullPage:true});screenshots.push(image);}finally{await reportPage.close();}}
  }
  await nav('handover');await page.locator('#prepare-handover').click();const archive=await download('#zip','asset-crosswalk-complete-handover.zip'),members=unzip(archive.bytes),manifest=JSON.parse(members.get('MANIFEST.json'));
  for(const f of manifest.files){const body=members.get(f.path);need(body&&body.length===f.bytes&&hash(body)===f.sha256,'An outgoing full member changed: '+f.path);}
  need(E.exportWorkspace(E.importWorkspace(members.get('workspace.json').toString('utf8')))===E.exportWorkspace(finalWS),'The editable ZIP changed the original crosswalk/financial history.');
  for(const f of boot.applicationSource.files)need(members.get('application/'+f.path)?.equals(Buffer.from(f.text)),'The complete source closure lost '+f.path);
  for(const f of X.exportFiles(finalWS).files)need(members.get(f.path)?.equals(Buffer.from(f.text)),'The original full handover lost a crosswalk output.');
  const extracted=path.join(root,'received');for(const [name,body]of members){const dest=path.resolve(extracted,name);need(dest.startsWith(extracted+path.sep),'Unsafe received member path.');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,body,{flag:'wx'});}
  const copied=path.join(extracted,'application/services/fixed-asset-migration'),portable=path.join(extracted,'workspace.json');
  const inspected=JSON.parse(execFileSync(process.execPath,[path.join(copied,'cli.mjs'),'crosswalk-inspect','--workspace',portable],{encoding:'utf8',maxBuffer:32*1024*1024}));need(inspected.head===r.head&&inspected.ready,'The copied CLI lost the original mapped decision.');
  const cliDirectory=path.join(root,'cli-handover');const cliResult=JSON.parse(execFileSync(process.execPath,[path.join(copied,'cli.mjs'),'handover','--workspace',portable,'--out',cliDirectory],{encoding:'utf8',maxBuffer:32*1024*1024}));
  for(const f of cliResult.files){const body=await fs.readFile(path.join(cliDirectory,f.path));need(body.length===f.bytes&&hash(body)===f.sha256,'A copied CLI handover member changed: '+f.path);}
  const cold=await browser.newContext({acceptDownloads:true}),opened=await cold.newPage();opened.on('pageerror',e=>errors.push(String(e)));
  try{await opened.goto(pathToFileURL(path.join(cliDirectory,'Fixed_Asset_Finance_Workspace.html')).href);await opened.locator('[data-tab="crosswalk"]').click();await opened.getByText('Mapped checks complete:',{exact:false}).first().waitFor();await opened.locator('[data-tab="preparation"]').click();await opened.locator('#sp-preview-button').waitFor();await opened.locator('[data-tab="crosswalk"]').click();for(const width of [1440,390]){await opened.setViewportSize({width,height:width===390?844:1000});const image=path.join(root,'05-cold-cli-application-'+width+'.png');await opened.screenshot({path:image,fullPage:true});screenshots.push(image);}const wait=opened.waitForEvent('download');await opened.locator('#top-json').click();const item=await wait,file=path.join(root,'cold-crosswalk-workspace.json');await item.saveAs(file);need(E.exportWorkspace(E.importWorkspace(await fs.readFile(file,'utf8')))===E.exportWorkspace(finalWS),'The copied cold application changed original source/crosswalk/financial history.');}finally{await cold.close();}
  need(errors.length===0,'The actual crosswalk browser reported: '+errors.join('; '));
  const result={schema:'tjlabs.asset-crosswalk-receiving.v1',application:{path:applicationPath,bytes:original.length,sha256:hash(original)},sourceMeaning:'Isolated illustrative renamed company/book/asset identities, not Port records.',workspaceId:finalWS.id,revision:finalWS.revision,head:r.head,historyCount:3,exactAmount:r.balances[0].source,originalValuesUnchanged:true,literalComparisonUnchanged:true,independentJournalCount:2,outputs,screenshots,cliHandover:cliDirectory,pageErrors:errors,producerView:'The producing owner must OPEN, LOOK at and use these actual desktop/narrow screens, downloaded HTML/CSV/JSON, full archives and cold application. A saved screenshot is not a viewing claim.'};
  await fs.writeFile(path.join(root,'asset-crosswalk-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
 }finally{await own.close();}
}
