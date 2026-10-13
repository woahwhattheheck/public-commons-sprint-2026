import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as engine from './engine.mjs';
import {DOMAINS,encodeCsv,importWorkspace,exportWorkspace,reconcile} from './engine.mjs';
import {openMigrationReceiving} from '../migration-receiving/continuation.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
async function download(page,selector,dir,name){const pending=page.waitForEvent('download');await page.locator(selector).click();const d=await pending,target=path.join(dir,name||d.suggestedFilename());await d.saveAs(target);const bytes=await fs.readFile(target);return{path:target,bytes:bytes.length,sha256:digest(bytes),content:bytes};}
function unzipStored(bytes){const files=new Map();let at=0;while(at+30<=bytes.length&&bytes.readUInt32LE(at)===0x04034b50){const flags=bytes.readUInt16LE(at+6),method=bytes.readUInt16LE(at+8),size=bytes.readUInt32LE(at+18),n=bytes.readUInt16LE(at+26),x=bytes.readUInt16LE(at+28);need(!(flags&8)&&method===0,'Receiving expects the original complete stored ZIP members.');const name=bytes.subarray(at+30,at+30+n).toString('utf8'),start=at+30+n+x;need(!files.has(name)&&start+size<=bytes.length,'The complete ZIP member differs.');files.set(name,bytes.subarray(start,start+size));at=start+size;}need(bytes.readUInt32LE(at)===0x02014b50,'The complete ZIP directory is missing.');return files;}
function divideThousand(text){
 const negative=text.startsWith('-'),value=negative?text.slice(1):text,[whole,fraction='']=value.split('.'),digits=whole.padStart(4,'0');
 return (negative?'-':'')+digits.slice(0,-3)+'.'+digits.slice(-3)+fraction;
}
export async function runFinanceReceiving({page,context,outputDirectory,applicationPath}){
 need(path.isAbsolute(outputDirectory)&&path.isAbsolute(applicationPath),'Use the original absolute application and receiving destinations.');
 const session=await openMigrationReceiving({page,outputDirectory,applicationPath,engine,title:'Receiving example fixed asset migration',resultFilename:'native-finance-receiving.json'});
 if(session.completed)return session.completed;
 try{
 outputDirectory=session.attempt;
await page.setViewportSize({width:1440,height:1000});
 const outputs=[],screens=[],appBytes=await fs.readFile(applicationPath);
 const phase=(name,fn)=>session.phase(name,fn,{outputs,screens});
 const shot=async(name)=>{const file=path.join(outputDirectory,name+'.png');await page.screenshot({path:file,fullPage:true});screens.push(file);};
 const nav=async(name)=>page.locator('[data-tab="'+name+'"]').click();
 const waitRevision=async(n)=>page.waitForFunction(n=>Number(document.querySelector('header')?.innerText.match(/Revision (\d+)/)?.[1])>=n,n);
 await phase('original-empty-workspace',async()=>{
 await page.setViewportSize({width:1440,height:1000});await shot('01-empty-desktop');await page.setViewportSize({width:390,height:844});await shot('02-empty-phone');await page.setViewportSize({width:1440,height:1000});
 });
 const company_id='COMP001',book_id='BOOK001',currency='GBP',asset_id='0001',opening='2026-03-31',closing='2026-09-30';
 const measures=['cost','accumulated_depreciation','carrying_value'];
 const figures={[opening]:['1000.01','300.01','700'],[closing]:['1200.03','330.02','870.01']};
 const records={
 assets:[{company_id,asset_id,parent_asset_id:'',class_code:'training',description:'Receiving example,\nquoted asset'}],
 books:[{company_id,book_id,currency,accounting_basis:'Receiving example: recorded cost less accumulated depreciation'}],
 balances:Object.entries(figures).flatMap(([as_of,amounts])=>measures.map((measure,i)=>({company_id,book_id,asset_id,as_of,currency,measure,amount:amounts[i]}))),
 events:[{company_id,book_id,asset_id,event_id:'EVENT001',effective_date:'2026-04-01',currency,measure:'cost',signed_amount:'200.02',event_type:'receiving example addition'},{company_id,book_id,asset_id,event_id:'EVENT002',effective_date:'2026-09-30',currency,measure:'accumulated_depreciation',signed_amount:'30.01',event_type:'receiving example depreciation movement'}],
 journals:[{company_id,book_id,journal_id:'J001',line_id:'001',posting_date:'2026-04-01',currency,account_code:'COST',debit:'200.02',credit:'0',asset_id},{company_id,book_id,journal_id:'J001',line_id:'002',posting_date:'2026-04-01',currency,account_code:'CASH',debit:'0',credit:'200.02',asset_id}],
 controls:Object.entries(figures).flatMap(([as_of,amounts])=>measures.map((measure,i)=>({company_id,book_id,as_of,currency,measure,amount:amounts[i],source_reference:'Explicit receiving-example independent control'})))
 };
 let originalCsv={},revision=0;
 const imported=await phase('complete-original-csv-selection',async()=>{
 for(const role of ['source','target'])for(const domain of Object.keys(DOMAINS)){
 const headers=DOMAINS[domain].fields.map(f=>f.name),data=records[domain].map(row=>({...row}));
 if(role==='source'&&domain==='balances')data[3].amount='1200.04';
 if(role==='target')for(const row of data)for(const key of ['amount','signed_amount','debit','credit'])if(row[key]!==undefined)row[key]=divideThousand(row[key]);
 const rows=data.map(row=>headers.map(key=>row[key]??''));
 if(domain==='assets'){headers.push('retained','retained');rows[0].push('first original column','second original column');}
 const csv=encodeCsv([headers,...rows]);originalCsv[role+'/'+domain]=csv;
 const file=path.join(outputDirectory,'receiving-example-'+role+'-'+domain+'.csv');await fs.writeFile(file,csv);
 await nav('sources');await page.locator('#domain').selectOption(domain);await page.locator('#role').selectOption(role);await page.locator('#csv').setInputFiles(file);await session.mutation('import-'+role+'-'+domain,revision+1,{operation:{kind:'import-csv',input:{role,domain,filename:path.basename(file)}},source:{sha256:digest(Buffer.from(csv)),role,domain}},()=>page.locator('#import-csv').click());revision++;await page.locator('#mapping-tab').click();
 if(['balances','events','journals','controls'].includes(domain))await page.locator('#amount-multiplier').selectOption(role==='target'?'1000':'1');
 await session.mutation('map-'+role+'-'+domain,revision+1,{operation:{kind:'save-mapping',input:{role,domain,columns:Object.fromEntries(DOMAINS[domain].fields.map((f,i)=>[f.name,i])),amount_multiplier:role==='target'&&['balances','events','journals','controls'].includes(domain)?1000:1}},source:{sha256:digest(Buffer.from(csv)),role,domain}},()=>page.locator('#save-map').click());revision++;
 }
 return{originalCsv,revision};});originalCsv=imported.originalCsv;revision=imported.revision;
 const annexes=[
 {name:'receiving-example-data-dictionary.json',bytes:Buffer.from(JSON.stringify({meaning:'Explicit receiving-example financial basis; no client records.',company_id,book_id,currency,measures,opening,closing,sourceUnit:'currency amounts',targetUnit:'thousands of currency units'},null,2)+'\n'),purpose:'Receiving example data dictionary and original amount-unit declaration.'},
 {name:'receiving-example-byte-preservation.dat',bytes:Buffer.from([0,1,2,127,128,254,255,10]),purpose:'Explicit receiving-example binary attachment used to exercise exact nontext preservation.'}
 ];
 const supporting=await phase('complete-original-supporting-selection',async()=>{await nav('supporting');
 for(const file of annexes){const location=path.join(outputDirectory,file.name);await fs.writeFile(location,file.bytes);await page.locator('#supporting-file').setInputFiles(location);await page.locator('#supporting-purpose').fill(file.purpose);await session.mutation('supporting-'+file.name,revision+1,{operation:{kind:'import-supporting',input:{filename:file.name,purpose:file.purpose}},supporting:{sha256:digest(file.bytes),bytes:file.bytes.length,filename:file.name,purpose:file.purpose}},()=>page.locator('#receive-supporting').click());revision++;}
 await shot('03-complete-supporting-files');return{revision};});revision=supporting.revision;
 const policyExpectation={kind:'save-finance-policy',input:{policy:{actor:'Receiving operator',note:'Explicit receiving-example complete population and all cost/depreciation movements. Scope checked against every retained original; amounts and thousands scale are explicit.',company_id,book_id,currency,opening_date:opening,closing_date:closing,event_scope_complete:true,population_complete:true,rollforward_measures:['cost','accumulated_depreciation'],carrying_equations:[{result_measure:'carrying_value',components:[{measure:'cost',coefficient:1},{measure:'accumulated_depreciation',coefficient:-1}]}]}}};
 const reviewed=await phase('original-financial-policy',async()=>{
 await nav('policy');const current=await session.checkpoint(),prior=current.operations[revision]?.input.policy;
 if(prior){await session.mutation('original-financial-policy',revision+1,policyExpectation,()=>{throw Error('Reopen the original saved policy.');});revision++;return{revision};}await page.locator('#new-policy').click();
 for(const [key,value]of Object.entries({company_id,book_id,currency,opening_date:opening,closing_date:closing,actor:'Receiving operator',note:'Explicit receiving-example complete population and all cost/depreciation movements for the declared period. Both source and returned target originals are retained.'}))await page.locator('[data-policy="'+key+'"]').fill(value);
 await page.locator('[data-policy="event_scope_complete"]').check();await page.locator('[data-policy="population_complete"]').check();await page.locator('#policy-measures').fill('cost\naccumulated_depreciation');
 await page.locator('#add-equation').click();await page.locator('[data-equation="0"][data-equation-field="result_measure"]').fill('carrying_value');await page.locator('[data-equation="0"][data-component="0"][data-component-field="measure"]').fill('cost');await page.locator('[data-add-component="0"]').click();await page.locator('[data-equation="0"][data-component="1"][data-component-field="measure"]').fill('accumulated_depreciation');await page.locator('[data-equation="0"][data-component="1"][data-component-field="coefficient"]').selectOption('-1');
 await page.locator('#confirm-policy').check();await page.locator('[data-policy="note"]').fill('Explicit receiving-example complete population and all cost/depreciation movements. Scope checked against every retained original; amounts and thousands scale are explicit.');need(!(await page.locator('#confirm-policy').isChecked()),'Editing the reviewed financial basis must clear confirmation.');
 await page.locator('#confirm-policy').check();await session.mutation('original-financial-policy',revision+1,policyExpectation,()=>page.locator('#save-policy').click());revision++;return{revision};});revision=reviewed.revision;
 await phase('original-financial-difference',async()=>{await nav('report');await page.locator('#run-report').click();const initial=await download(page,'#report-json',outputDirectory,'original-financial-reconciliation.json');outputs.push(initial);const first=JSON.parse(initial.content);need(!first.ready&&first.financial.rollforwards.some(r=>r.role==='source'&&r.measure==='cost'&&r.state==='DIFFERENCE'),'Original one-cent financial difference was not reported.');await shot('04-original-financial-difference');});
 const corrected=await phase('reviewed-original-correction',async()=>{await nav('sources');await page.locator('#domain').selectOption('balances');await page.locator('#role').selectOption('source');await page.locator('[data-row]').nth(3).click();
 const amountColumn=DOMAINS.balances.fields.findIndex(f=>f.name==='amount');
 await page.locator('#column').selectOption(String(amountColumn));await page.locator('#value').fill('1200.03');await page.locator('#reason').fill('Receiving example: correct the deliberately changed original closing cost against its retained expected control.');await page.locator('#actor').fill('Receiving operator');
 await page.locator('#row-id').fill('missing-receiving-example-row');await page.locator('#correct').click();await page.getByText('Select an existing original row and cell.',{exact:true}).waitFor();need(await page.locator('#value').inputValue()==='1200.03','Correction value disappeared after the error.');need((await page.locator('#reason').inputValue()).includes('Receiving example'),'Correction reason disappeared after the error.');
 await page.locator('[data-row]').nth(3).click();await page.locator('#column').selectOption(String(amountColumn));await page.locator('#value').fill('1200.03');await session.mutation('reviewed-original-correction',revision+1,{operation:{kind:'save-correction',input:{column:amountColumn,value:'1200.03',reason:'Receiving example: correct the deliberately changed original closing cost against its retained expected control.',actor:'Receiving operator'}},source:{role:'source',domain:'balances',sha256:digest(Buffer.from(originalCsv['source/balances']))},rowRecord:5},()=>page.locator('#correct').click());revision++;return{revision};});revision=corrected.revision;
 await phase('changed-financial-basis',async()=>{await nav('report');await page.locator('#run-report').click();const stale=await download(page,'#report-json',outputDirectory,'changed-source-financial-basis.json');outputs.push(stale);const changed=JSON.parse(stale.content);need(changed.financial.policies.some(p=>!p.basisCurrent)&&!changed.financial.confirmed,'Changed source retained an old financial attestation.');});
 const reReviewed=await phase('review-current-financial-basis',async()=>{
 await nav('policy');await page.locator('#confirm-policy').check();await session.mutation('review-current-financial-basis',revision+1,policyExpectation,()=>page.locator('#save-policy').click());revision++;return{revision};});revision=reReviewed.revision;
 await phase('complete-financial-reconciliation',async()=>{await nav('report');await page.locator('#run-report').click();const complete=await download(page,'#report-json',outputDirectory,'complete-financial-reconciliation.json');outputs.push(complete);const result=JSON.parse(complete.content);
 need(result.ready&&result.financial.confirmed,'Complete financial reconciliation is not ready.');
 need(result.summary.sourceRows===18&&result.summary.targetRows===18,'Complete six-domain population differs.');
 need(result.financial.rollforwards.some(r=>r.role==='source'&&r.measure==='cost'&&r.expected==='1200.03'&&r.state==='MATCH'),'Exact cost movement differs.');
 need(result.financial.equations.some(r=>r.role==='target'&&r.result_measure==='carrying_value'&&r.expected==='870.01'&&r.state==='MATCH'),'Target thousands-scale carrying equation differs.');
 await shot('05-complete-financial-desktop');await page.setViewportSize({width:390,height:844});await shot('06-complete-financial-phone');await page.setViewportSize({width:1440,height:1000});
 const readable=await download(page,'#report-html',outputDirectory,'complete-readable-financial-report.html');outputs.push(readable);
 const reader=await context.newPage();try{await reader.goto(pathToFileURL(readable.path).href);await reader.locator('h1').waitFor();await reader.setViewportSize({width:1440,height:1000});const image=path.join(outputDirectory,'07-complete-readable-report.png');await reader.screenshot({path:image,fullPage:true});screens.push(image);need((await reader.locator('body').innerText()).includes('870.01'),'Readable complete report omitted exact financial values.');}finally{await reader.close();} });
 const handover=await phase('complete-original-handover',async()=>{await nav('handover');await page.locator('#prepare-handover').click();const zip=await download(page,'#zip',outputDirectory,'complete-financial-handover.zip');outputs.push(zip);
 const members=unzipStored(zip.content),manifest=JSON.parse(members.get('MANIFEST.json').toString('utf8'));
 for(const f of manifest.files){const body=members.get(f.path);need(body&&body.length===f.bytes&&digest(body)===f.sha256,'A complete handover member differs: '+f.path);}
 const received=importWorkspace(members.get('workspace.json').toString('utf8'));
 need(received.revision===revision&&received.sources.length===12&&received.corrections.length===1&&received.financePolicyHistory.length===2&&received.supportingFiles.length===2,'Full finance workspace handover history differs.');
 for(const s of received.sources)need(s.text===originalCsv[s.role+'/'+s.domain],'An original source changed.');
 for(const f of received.supportingFiles){const original=annexes.find(a=>a.name===f.filename);need(original&&Buffer.from(f.base64,'base64').equals(original.bytes),'Original supporting bytes changed.');need([...members.values()].some(body=>body.equals(original.bytes)),'An original supporting attachment is missing from the handover.');}
 const extracted=path.join(outputDirectory,'received-handover');await fs.mkdir(extracted,{recursive:true});
 for(const [name,body]of members){const file=path.resolve(extracted,name);need(file.startsWith(extracted+path.sep),'Unsafe handover member path.');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,body);}
 const portable=await download(page,'#workspace-json',outputDirectory,'portable-finance-workspace.json');outputs.push(portable);need(exportWorkspace(importWorkspace(portable.content.toString('utf8')))===exportWorkspace(received),'Download and ZIP complete histories differ.');
 const full=await download(page,'#save-html',outputDirectory,'independent-finance-working.html');outputs.push(full);return{members:[...members],received,portable,full};});
 const members=new Map(handover.members),received=handover.received,portable=handover.portable,full=handover.full;
 await phase('independent-working-copy-continuation',async()=>{const second=await context.newPage();try{
 await second.goto(pathToFileURL(full.path).href);await second.locator('#import-csv').waitFor();const before=await download(second,'#top-json',outputDirectory,'independent-before-continuation.json');outputs.push(before);const beforeWS=importWorkspace(before.content.toString('utf8'));
 need(beforeWS.id===received.id&&JSON.stringify(beforeWS.operations.slice(0,revision))===JSON.stringify(received.operations)&&(beforeWS.revision===revision||beforeWS.revision===revision+1),'Reopen the exact original independent receiving history.');
 if(beforeWS.revision===revision){
 await second.locator('#domain').selectOption('assets');await second.locator('#role').selectOption('source');await second.locator('[data-row]').first().click();await second.locator('#column').selectOption(String(DOMAINS.assets.fields.findIndex(f=>f.name==='description')));await second.locator('#value').fill('Independent receiving asset');await second.locator('#reason').fill('Independent receiving continuation');await second.locator('#actor').fill('Receiving operator');await second.locator('#correct').click();await second.waitForFunction(n=>document.querySelector('header').innerText.includes('Revision '+n+' ·'),revision+1);}else need(beforeWS.operations[revision].kind==='save-correction'&&beforeWS.operations[revision].input.sourceId===received.sources.find(s=>s.role==='source'&&s.domain==='assets').id&&beforeWS.operations[revision].input.rowId===received.sources.find(s=>s.role==='source'&&s.domain==='assets').rows[0].id&&beforeWS.operations[revision].input.column===DOMAINS.assets.fields.findIndex(f=>f.name==='description')&&beforeWS.operations[revision].input.value==='Independent receiving asset'&&beforeWS.operations[revision].input.reason==='Independent receiving continuation'&&beforeWS.operations[revision].input.actor==='Receiving operator','The independent receiving operation differs.');
 const continued=await download(second,'#top-json',outputDirectory,'independent-continued-finance-workspace.json');outputs.push(continued);need(importWorkspace(continued.content.toString('utf8')).corrections.length===2,'Independent receiving edit was not retained.');need((await page.locator('header').innerText()).includes('Revision '+revision+' ·'),'Independent HTML changed the original working copy.');
 await second.setViewportSize({width:390,height:844});const image=path.join(outputDirectory,'08-independent-receiving-phone.png');await second.screenshot({path:image,fullPage:true});screens.push(image);
 }finally{await second.close();} });
 await phase('complete-workspace-receive-and-original-reopen',async()=>{await nav('handover');const invalid=path.join(outputDirectory,'invalid-incoming.json');await fs.writeFile(invalid,JSON.stringify({schema:'invalid',workspace:{}}));await page.locator('#receive-file').setInputFiles(invalid);await page.locator('#receive').click();await page.getByText('The complete saved workspace identity differs.',{exact:true}).waitFor();need((await page.locator('header').innerText()).includes('Revision '+revision+' ·'),'Invalid receiving replaced original work.');await shot('09-invalid-receive-preserved');
 await page.locator('#receive-file').setInputFiles(portable.path);const prior=page.waitForEvent('download');await page.locator('#receive').click();await(await prior).saveAs(path.join(outputDirectory,'before-receive-finance-working.html'));await page.getByText('Received complete workspace as a new independent working copy. Save the working HTML to retain it.',{exact:true}).waitFor();
 await nav('sources');await page.locator('#domain').selectOption('assets');await page.locator('#role').selectOption('source');const original=await download(page,'#original',outputDirectory,'received-original-assets.csv');outputs.push(original);need(original.content.toString('utf8')===originalCsv['source/assets'],'Reopened original CSV differs.');await shot('10-received-original-columns');});
 const receipt={schema:'tjlabs.fixed-asset-native-receiving.v1',application:{path:applicationPath,bytes:appBytes.length,sha256:digest(appBytes)},sourceMeaning:'Explicit receiving-example finance data with one deliberately changed cent, exact amounts and target-thousands scale; all original inputs and binary supporting files are retained.',originalRevision:revision,independentRevision:revision+1,sourceRows:18,targetRows:18,handovers:members.size,outputs:outputs.map(({content,...x})=>x),screenshots:screens,producerView:'The responsible producer opens and LOOKS at these actual screenshots, the working application, all outgoing attachments and complete reopened files, repairs concrete defects, and records the actual viewed edition.'};
 return await session.finish(receipt);
 }finally{await session.close();}
}
