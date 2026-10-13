import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as engine from './engine.mjs';
import {openMigrationReceiving} from '../migration-receiving/continuation.mjs';
import {DOMAINS,encodeCsv,importWorkspace,exportWorkspace,reconcile} from './engine.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
async function download(page,selector,dir,name){const pending=page.waitForEvent('download');await page.locator(selector).click();const d=await pending,target=path.join(dir,name||d.suggestedFilename());await d.saveAs(target);const bytes=await fs.readFile(target);return{path:target,bytes:bytes.length,sha256:digest(bytes),content:bytes};}
function unzipStored(bytes){const files=new Map();let at=0;while(at+30<=bytes.length&&bytes.readUInt32LE(at)===0x04034b50){const flags=bytes.readUInt16LE(at+6),method=bytes.readUInt16LE(at+8),size=bytes.readUInt32LE(at+18),n=bytes.readUInt16LE(at+26),x=bytes.readUInt16LE(at+28);need(!(flags&8)&&method===0,'Receiving expects the original complete stored ZIP members.');const name=bytes.subarray(at+30,at+30+n).toString('utf8'),start=at+30+n+x;need(!files.has(name)&&start+size<=bytes.length,'The complete ZIP member differs.');files.set(name,bytes.subarray(start,start+size));at=start+size;}need(bytes.readUInt32LE(at)===0x02014b50,'The complete ZIP directory is missing.');return files;}
export async function runUniformReceiving({page,context,outputDirectory,applicationPath}){
need(path.isAbsolute(outputDirectory)&&path.isAbsolute(applicationPath),'Use original absolute application and receiving destinations.');
const session=await openMigrationReceiving({page,outputDirectory,applicationPath,engine,title:'Receiving example inventory migration',resultFilename:'native-receiving.json'});
if(session.completed)return session.completed;
try{
outputDirectory=session.attempt;
await page.setViewportSize({width:1440,height:1000});
const outputs=[],screens=[],appBytes=await fs.readFile(applicationPath);
const phase=(name,fn)=>session.phase(name,fn,{outputs,screens});
const shot=async(name)=>{const file=path.join(outputDirectory,name+'.png');await page.screenshot({path:file,fullPage:true});screens.push(file);};
const nav=async(name)=>page.locator('[data-tab="'+name+'"]').click();
await phase('original-empty-workspace',async()=>{
await page.setViewportSize({width:1440,height:1000});await shot('01-empty-desktop');
await page.setViewportSize({width:390,height:844});await shot('02-empty-phone');await page.setViewportSize({width:1440,height:1000});
});
const records={
locations:[['L001','Receiving example location','','true']],
wearers:[['0001','L001','Receiving example operator','active']],
products:[['P001','SKU0001','Receiving example,\nquoted garment','each','training']],
entitlements:[['E001','0001','P001','3','each','2026-10-13','2026-12-31']],
stock:[['S001','L001','P001','10','each']],
issues:[['I001','0001','P001','L001','5','each','2026-10-13','A001']],
returns:[['R001','I001','2.1','each','2026-10-13','L001','A001'],['R002','I001','2.9','each','2026-10-13','L001','A001']],
assets:[['A001','P001','SERIAL0001','0001','L001','issued','2026-10-13','']]
};
let originalCsv={},revision=0;
const imported=await phase('complete-original-csv-selection',async()=>{
for(const role of ['source','target'])for(const domain of Object.keys(DOMAINS)){
const rows=records[domain].map(r=>[...r]);if(role==='source'&&domain==='returns')rows[1][2]='3';
const headers=DOMAINS[domain].fields.map(f=>f.name);if(domain==='products'){headers.push('retained','retained');rows[0].push('first original column','second original column');}
const csv=encodeCsv([headers,...rows]);originalCsv[role+'/'+domain]=csv;const file=path.join(outputDirectory,'receiving-example-'+role+'-'+domain+'.csv');await fs.writeFile(file,csv);
await nav('sources');await page.locator('#domain').selectOption(domain);await page.locator('#role').selectOption(role);await page.locator('#csv').setInputFiles(file);await session.mutation('import-'+role+'-'+domain,revision+1,{operation:{kind:'import-csv',input:{role,domain,filename:path.basename(file)}},source:{sha256:digest(Buffer.from(csv)),role,domain}},()=>page.locator('#import-csv').click());revision++;await page.locator('#mapping-tab').click();await session.mutation('map-'+role+'-'+domain,revision+1,{operation:{kind:'save-mapping',input:{role,domain,columns:Object.fromEntries(DOMAINS[domain].fields.map((f,i)=>[f.name,i]))}},source:{sha256:digest(Buffer.from(csv)),role,domain}},()=>page.locator('#save-map').click());revision++;
}
return{originalCsv,revision};});originalCsv=imported.originalCsv;revision=imported.revision;
await phase('original-return-finding',async()=>{await nav('report');await page.locator('#run-report').click();await page.getByText('RETURNS_EXCEED_ISSUE',{exact:true}).waitFor();await shot('03-original-return-finding');});
const corrected=await phase('reviewed-original-correction',async()=>{await nav('sources');await page.locator('#domain').selectOption('returns');await page.locator('#role').selectOption('source');
await page.locator('[data-row]').nth(1).click();await page.locator('#column').selectOption('2');await page.locator('#value').fill('2.9');await page.locator('#reason').fill('Receiving example: correct the intentionally changed original quantity to its recorded expected value.');await page.locator('#actor').fill('Receiving operator');
await page.locator('#row-id').fill('missing-example-row');await page.locator('#correct').click();await page.getByText('Select an existing original row and cell.',{exact:true}).waitFor();need(await page.locator('#value').inputValue()==='2.9','Correction value disappeared after validation error.');need((await page.locator('#reason').inputValue()).includes('Receiving example'),'Reviewed correction reason disappeared.');
await page.locator('[data-row]').nth(1).click();await page.locator('#column').selectOption('2');await page.locator('#value').fill('2.9');await session.mutation('reviewed-original-correction',revision+1,{operation:{kind:'save-correction',input:{column:2,value:'2.9',reason:'Receiving example: correct the intentionally changed original quantity to its recorded expected value.',actor:'Receiving operator'}},source:{role:'source',domain:'returns',sha256:digest(Buffer.from(originalCsv['source/returns']))},rowRecord:3},()=>page.locator('#correct').click());revision++;return{revision};});revision=corrected.revision;
await phase('complete-reconciliation',async()=>{await nav('report');await page.locator('#run-report').click();await page.getByText('Reconciled under selected mappings',{exact:true}).waitFor();await shot('04-complete-reconciliation-desktop');await page.setViewportSize({width:390,height:844});await shot('05-complete-reconciliation-phone');await page.setViewportSize({width:1440,height:1000});
const report=await download(page,'#report-json',outputDirectory,'complete-reconciliation.json');outputs.push(report);const result=JSON.parse(report.content);need(result.ready&&result.summary.sourceRows===9&&result.summary.targetRows===9,'Complete eight-domain reconciliation differs.');need(result.returnTotals.source[0].total==='5','Exact corrected return total differs.');});
const handover=await phase('complete-original-handover',async()=>{await nav('handover');await page.locator('#prepare-handover').click();const zip=await download(page,'#zip',outputDirectory,'complete-handover.zip');outputs.push(zip);const members=unzipStored(zip.content),manifest=JSON.parse(members.get('MANIFEST.json').toString('utf8'));for(const f of manifest.files){const body=members.get(f.path);need(body&&body.length===f.bytes&&digest(body)===f.sha256,'Complete handover member differs: '+f.path);}
const received=importWorkspace(members.get('workspace.json').toString('utf8'));need(received.revision===33&&received.sources.length===16&&received.corrections.length===1,'Full workspace handover history differs.');for(const s of received.sources)need(s.text===originalCsv[s.role+'/'+s.domain],'An original source changed.');
const extracted=path.join(outputDirectory,'received-handover');await fs.mkdir(extracted,{recursive:true});for(const [name,body]of members){const file=path.resolve(extracted,name);need(file.startsWith(extracted+path.sep),'Unsafe member path.');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,body);}
const portable=await download(page,'#workspace-json',outputDirectory,'portable-workspace.json');outputs.push(portable);need(exportWorkspace(importWorkspace(portable.content.toString('utf8')))===exportWorkspace(received),'Download and ZIP portable histories differ.');
const full=await download(page,'#save-html',outputDirectory,'independent-working.html');outputs.push(full);return{members:[...members],received,portable,full};});
const members=new Map(handover.members),received=handover.received,portable=handover.portable,full=handover.full;
await phase('independent-working-copy-continuation',async()=>{const second=await context.newPage();try{await second.goto(pathToFileURL(full.path).href);await second.locator('#import-csv').waitFor();const before=await download(second,'#top-json',outputDirectory,'independent-before-continuation.json');outputs.push(before);const beforeWS=importWorkspace(before.content.toString('utf8'));
need(beforeWS.id===received.id&&JSON.stringify(beforeWS.operations.slice(0,33))===JSON.stringify(received.operations)&&(beforeWS.revision===33||beforeWS.revision===34),'Reopen the exact original independent receiving history.');
if(beforeWS.revision===33){await second.locator('#domain').selectOption('locations');await second.locator('#role').selectOption('source');await second.locator('[data-row]').first().click();await second.locator('#column').selectOption('1');await second.locator('#value').fill('Independent receiving location');await second.locator('#reason').fill('Independent receiving continuation');await second.locator('#actor').fill('Receiving operator');await second.locator('#correct').click();await second.waitForFunction(()=>document.querySelector('header').innerText.includes('Revision 34'));}else need(beforeWS.operations[33].kind==='save-correction'&&beforeWS.operations[33].input.sourceId===received.sources.find(s=>s.role==='source'&&s.domain==='locations').id&&beforeWS.operations[33].input.rowId===received.sources.find(s=>s.role==='source'&&s.domain==='locations').rows[0].id&&beforeWS.operations[33].input.column===1&&beforeWS.operations[33].input.value==='Independent receiving location'&&beforeWS.operations[33].input.reason==='Independent receiving continuation'&&beforeWS.operations[33].input.actor==='Receiving operator','The independent receiving operation differs.');const continued=await download(second,'#top-json',outputDirectory,'independent-continued-workspace.json');outputs.push(continued);need(importWorkspace(continued.content.toString('utf8')).corrections.length===2,'Independent receiving edit did not persist.');need((await page.locator('header').innerText()).includes('Revision 33'),'Independent saved HTML changed original working copy.');
await second.setViewportSize({width:1440,height:1000});const image=path.join(outputDirectory,'06-independent-receiving.png');await second.screenshot({path:image,fullPage:true});screens.push(image);
}finally{await second.close();} });
await phase('complete-workspace-receive-and-original-reopen',async()=>{await nav('handover');const invalid=path.join(outputDirectory,'invalid-incoming.json');await fs.writeFile(invalid,JSON.stringify({schema:'invalid',workspace:{}}));await page.locator('#receive-file').setInputFiles(invalid);await page.locator('#receive').click();await page.getByText('The complete saved workspace identity differs.',{exact:true}).waitFor();need((await page.locator('header').innerText()).includes('Revision 33'),'Invalid receive replaced original work.');await shot('07-invalid-receive-preserved');
await page.locator('#receive-file').setInputFiles(portable.path);const backup=page.waitForEvent('download');await page.locator('#receive').click();const prior=await backup;await prior.saveAs(path.join(outputDirectory,'before-receive-working.html'));await page.getByText('Received complete workspace as a new independent working copy. Save the working HTML to retain it.',{exact:true}).waitFor();
await nav('sources');await page.locator('#domain').selectOption('products');await page.locator('#role').selectOption('source');await shot('08-received-original-columns');
const source=await download(page,'#original',outputDirectory,'received-original-products.csv');outputs.push(source);need(source.content.toString('utf8')===originalCsv['source/products'],'Reopened original CSV differs.');});
const receipt={schema:'tjlabs.uniform-native-receiving.v1',application:{path:applicationPath,bytes:appBytes.length,sha256:digest(appBytes)},sourceMeaning:'Explicit receiving-example data, including one deliberately changed quantity; complete original and returned target files are retained.',originalRevision:33,independentRevision:34,sourceRows:9,targetRows:9,handovers:members.size,outputs:outputs.map(({content,...x})=>x),screenshots:screens,producerView:'The original responsible producer must open and LOOK at these actual screenshots and every outgoing attachment, repair concrete defects, and record viewed results before presenting this edition.'};
return await session.finish(receipt);
}finally{await session.close();}
}
