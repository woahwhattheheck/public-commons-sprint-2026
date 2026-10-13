import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as Engine from './engine.mjs';
import * as Portable from './portable.mjs';
import {openMigrationReceiving} from '../migration-receiving/continuation.mjs';

const need=(ok,message)=>{if(!ok)throw Error(message);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const attr=value=>JSON.stringify(String(value));
const within=(root,name)=>{need(typeof name==='string'&&!path.isAbsolute(name)&&!name.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'),'Use an exact relative receiving member.');const file=path.resolve(root,name);need(file.startsWith(root+path.sep),'Keep the receiving member inside its original directory.');return file;};
async function original(file,bytes){
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});let old;
 try{const s=await fs.lstat(file);need(s.isFile()&&!s.isSymbolicLink(),'Retain an ordinary receiving file.');old=await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(old){need(old.equals(bytes),'An original receiving file already has different bytes: '+file);return file;}
 const temp=file+'.'+randomUUID()+'.candidate';let h;
 try{h=await fs.open(temp,'wx',0o600);await h.writeFile(bytes);await h.sync();await h.close();h=null;try{await fs.link(temp,file);}catch(e){if(e.code!=='EEXIST'||!(await fs.readFile(file)).equals(bytes))throw e;}}
 finally{if(h)await h.close();await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}return file;
}
function readBoot(html){const m=html.match(/(<script id="application-boot" type="application\/json">)([\s\S]*?)(<\/script>)/);need(m,'Read the actual complete application bootstrap.');return{match:m,boot:JSON.parse(m[2])};}
function seedHTML(html,{copyId,portable}){
 const {match,boot}=readBoot(html),record=Portable.parseRecovery(portable);record.copyId=copyId;
 return html.replace(match[0],()=>match[1]+JSON.stringify({...boot,record,copyId}).replace(/</g,'\\u003c')+match[3]);
}
const workspaceModel={id:'application-packet-recovery-journal-v1',identity:r=>({id:r.workspace.id,title:r.workspace.title,createdAt:r.workspace.createdAt}),revision:r=>r.workspace.journal.length,operations:r=>r.workspace.journal,sequence:o=>o.sequence};
const receivingEngine={
 createWorkspace:options=>Portable.recovery(Engine.createWorkspace(options),{}, {section:'workspace',caseId:null,instanceId:null}),
 exportWorkspace:record=>Portable.json(record),importWorkspace:Portable.parseRecovery
};
function crc32(bytes){let c=0xffffffff;for(const n of bytes){c^=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function unzipStored(bytes){
 const rows=new Map();let offset=0;
 while(offset+4<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
  need(offset+30<=bytes.length,'Read the full ZIP local header.');const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8),sum=bytes.readUInt32LE(offset+14),size=bytes.readUInt32LE(offset+18),rawSize=bytes.readUInt32LE(offset+22),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
  need(flags===0x800&&method===0&&size===rawSize,'Open this application’s complete uncompressed UTF-8 ZIP.');const start=offset+30+n+extra,end=start+size;need(end<=bytes.length,'Read every original ZIP byte.');
  const name=bytes.subarray(offset+30,offset+30+n).toString('utf8');need(!rows.has(name)&&!name.startsWith('/')&&!name.includes('\\')&&!name.split('/').some(p=>!p||p==='.'||p==='..'),'Keep distinct safe complete ZIP members.');
  const body=bytes.subarray(start,end);need(crc32(body)===sum,'A complete ZIP member has a different CRC.');rows.set(name,body);offset=end;
 }
 const centralStart=offset;let count=0;
 while(offset+4<=bytes.length&&bytes.readUInt32LE(offset)===0x02014b50){
  need(offset+46<=bytes.length,'Read the full ZIP directory.');const n=bytes.readUInt16LE(offset+28),e=bytes.readUInt16LE(offset+30),c=bytes.readUInt16LE(offset+32),name=bytes.subarray(offset+46,offset+46+n).toString('utf8');
  need(rows.has(name)&&bytes.readUInt32LE(offset+24)===rows.get(name).length&&bytes.readUInt32LE(offset+16)===crc32(rows.get(name)),'ZIP directory differs from its complete original member.');count++;offset+=46+n+e+c;
 }
 need(offset+22===bytes.length&&bytes.readUInt32LE(offset)===0x06054b50&&bytes.readUInt16LE(offset+10)===rows.size&&count===rows.size&&bytes.readUInt32LE(offset+16)===centralStart,'Read one complete original ZIP with every member.');return rows;
}
async function beforeCheckpoint(page){
 const section=await page.locator('#navigation [aria-current="page"]').getAttribute('data-section');
 if(section!=='workspace')await page.locator('#navigation [data-section="workspace"]').click();
 await page.locator('#top-json').waitFor();
 return async()=>{if(section&&section!=='workspace')await page.locator('#navigation [data-section='+attr(section)+']').click();};
}
async function fill(form,fields){
 for(const [name,value]of Object.entries(fields)){
  const node=form.locator('[name='+attr(name)+']');need(await node.count()===1,'Use the actual form control '+name+'.');
  const type=await node.getAttribute('type'),tag=await node.evaluate(n=>n.tagName.toLowerCase());
  if(type==='checkbox')await node.setChecked(value===true);else if(tag==='select')await node.selectOption(String(value));else await node.fill(String(value));
 }
 const adopt=form.getByRole('button',{name:'Use these values for the current revision',exact:true});if(await adopt.isVisible())await adopt.click();
}
async function ready(page){await page.locator('#operator-name').waitFor();await page.waitForFunction(()=>!document.querySelector('#operator-name')?.disabled);}
async function nav(page,name){await ready(page);await page.locator('#navigation [data-section='+attr(name)+']').click();await ready(page);const picker=page.locator('select[name="caseSelection"]');if(await picker.count()&&!(await picker.inputValue())){const value=await picker.locator('option').first().getAttribute('value');if(value)await picker.selectOption(value);await ready(page);}}
async function submit(page,action,fields,files=null){
 const form=page.locator('form[data-action='+attr(action)+']');await form.waitFor();await fill(form,fields);
 if(files)await form.locator('input[type=file]').setInputFiles(files);
 await form.locator('button[type=submit]').click();
}
async function download(page,locator,file){const pending=page.waitForEvent('download');await locator.click();const d=await pending;await d.saveAs(file);return fs.readFile(file);}
async function viewText(page,title,text){await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title></title><style>body{font:15px system-ui;margin:24px;color:#171717;background:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}</style><h1></h1><pre></pre>');await page.locator('title').evaluate((n,v)=>n.textContent=v,title);await page.locator('h1').evaluate((n,v)=>n.textContent=v,title);await page.locator('pre').evaluate((n,v)=>n.textContent=v,text);}

/** Operate the complete original application in the caller's existing browser and context. */
export async function runApplicationPacketReceiving({page,context,sourceDirectory,outputDirectory,attachments=[]}){
 need(page&&context&&path.isAbsolute(sourceDirectory)&&path.isAbsolute(outputDirectory),'Use the existing page/context and absolute original source/receiving directories.');
 const source=await fs.realpath(sourceDirectory),appPath=path.join(source,'Application_Packet_Workspace.html'),appBytes=await fs.readFile(appPath),{boot}=readBoot(appBytes.toString('utf8'));
 for(const name of ['engine.mjs','sha256.mjs','portable.mjs','app.mjs','template.html','style.css','build.mjs','cli.mjs','README.md','BROWSER_OPERATING.md']){
  const bytes=await fs.readFile(path.join(source,name));need(boot.source[name]===bytes.toString('utf8'),'The displayed application contains another complete source edition: '+name);
 }
 const fixtureBytes=await fs.readFile(path.join(source,'examples/demonstration-workspace.json')),fixture=Engine.importWorkspace(fixtureBytes.toString('utf8'));
 const fixtureState=Engine.inspect(fixture);need(fixture.journal.length===32&&fixtureState.files.length===7,'Use the complete retained v4.2 demonstration input, including original binary bytes.');
 const selectedAttachments=[];need(Array.isArray(attachments)&&attachments.length>0,'Choose the complete actual outgoing attachment selection for this original programme.');
 for(const entry of attachments){need(entry&&path.isAbsolute(entry.path)&&typeof entry.sha256==='string'&&Number.isSafeInteger(entry.bytes),'Bind every complete original attachment.');const st=await fs.lstat(entry.path);need(st.isFile()&&!st.isSymbolicLink(),'Use the ordinary selected original attachment.');const bytes=await fs.readFile(entry.path);need(bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'An actual outgoing attachment differs from its selected identity.');selectedAttachments.push({path:entry.path,bytes:entry.bytes,sha256:entry.sha256});}
 need(selectedAttachments.some(a=>a.bytes===appBytes.length&&a.sha256===sha(appBytes)),'Include the exact outgoing application in the complete attachment selection.');
 const callbackBytes=await fs.readFile(fileURLToPath(import.meta.url)),helperBytes=await fs.readFile(fileURLToPath(new URL('../migration-receiving/continuation.mjs',import.meta.url)));
 const selectedInputs={schema:'commons.application-packet-receiving-inputs.v1',application:{bytes:appBytes.length,sha256:sha(appBytes)},fixture:{bytes:fixtureBytes.length,sha256:sha(fixtureBytes)},callback:{bytes:callbackBytes.length,sha256:sha(callbackBytes)},continuation:{bytes:helperBytes.length,sha256:sha(helperBytes)},attachments:selectedAttachments};

 await page.setViewportSize({width:1440,height:1000});
 const r=await openMigrationReceiving({page,outputDirectory,applicationPath:appPath,engine:receivingEngine,title:'Application packet complete receiving example',resultFilename:'application-packet-browser-result.json',workspaceModel,browserControls:{ready:'#workspace-revision',workspaceDownload:'#top-json',seedHTML,beforeCheckpoint}});
  if(r.completed){const old=r.completed.selectedInputs;need(JSON.stringify(old)===JSON.stringify(selectedInputs),'Continue the exact completed original source and attachments.');return r.completed;}
 const outputs=[],screens=[],steps=[],errors=[],tabs=new Set();const onError=e=>errors.push(String(e));page.on('pageerror',onError);
 const add=async(file,kind)=>{const bytes=await fs.readFile(file);const row={path:file,kind,bytes:bytes.length,sha256:sha(bytes)};outputs.push(row);return row;};
 const capture=async(label,p=page)=>{const file=path.join(r.attempt,label+'.png');await p.screenshot({path:file,fullPage:true});screens.push(file);return file;};
 const record=()=>r.checkpoint(),state=async()=>Engine.inspect((await record()).workspace);
 const phase=(name,fn)=>r.phase(name,fn,{outputs,screens});
 const input=action=>fixture.journal.find(o=>o.action===action)?.input;
 const fileInput=id=>fixtureState.files.find(f=>f.id===id);
 const findFile=(s,id)=>s.files.find(f=>f.filename===fileInput(id).filename);
 const caseOf=s=>s.cases.find(c=>c.reference==='receiving-demo-case');
 const person=(s,ref)=>s.subjects.find(p=>p.reference===ref);
 const inst=(s,ref)=>s.instances.find(i=>i.caseId===caseOf(s).id&&i.subjectId===person(s,ref).id);
 const op=(key,revision,expected,perform)=>r.mutation(key,revision,expected,perform);
 const doForm=async(section,action,fields,files)=>{await nav(page,section);await submit(page,action,fields,files);};
 const keepFile=async(id,revision)=>{
  const f=fileInput(id),p=await original(path.join(r.attempt,'inputs',f.filename),Buffer.from(f.base64,'base64'));
  return op('original-'+id,revision,{action:'addFile',input:{filename:f.filename,mimeType:f.mimeType,purpose:f.purpose,base64:f.base64}},()=>doForm('sources','addFile',{purpose:f.purpose},[{name:f.filename,mimeType:f.mimeType,buffer:Buffer.from(f.base64,'base64')}]));
 };
 const setForm=async(s,ref,revision,reason,values,fileId)=>{
  const i=inst(s,ref),e=findFile(s,fileId),fields={applicability:'applies',reason};
  for(const [k,v]of Object.entries(values)){fields['present:'+k]=true;fields['value:'+k]=v;}
  for(const f of s.files)fields['evidence:'+f.id]=f.id===e.id;
  return op('form-'+revision,revision,{action:'setInstance',input:{instanceId:i.id,applicability:'applies',reason,values,evidenceIds:[e.id]}},async()=>{await nav(page,'forms');await page.locator('[data-instance-id='+attr(i.id)+']').click();await submit(page,'setInstance:'+i.id,fields);});
 };
 try{
  await original(path.join(r.root,'selected-original-inputs.json'),json(selectedInputs));await original(path.join(r.attempt,'selected-original-inputs.json'),json(selectedInputs));
  await ready(page);await page.locator('#operator-name').fill('Receiving operator');
  await phase('source-edition-case-and-distinct-subjects',async()=>{
   await keepFile('source-file',1);let s=await state(),f=findFile(s,'source-file'),a=input('addSource');
   await op('source-edition',2,{action:'addSource',input:{title:a.title,publisher:a.publisher,url:a.url,issued:a.issued,retrieved:a.retrieved,note:a.note,fileIds:[f.id]}},()=>doForm('sources','addSource',{title:a.title,publisher:a.publisher,url:a.url,issued:a.issued,retrieved:a.retrieved,note:a.note,['sourceFiles:'+f.id]:true}));
   s=await state();const ed=input('addEdition'),sourceId=s.sources[0].id,requirements=ed.requirements.map(x=>({...x,sourceId}));
   await op('requirements',3,{action:'addEdition',input:{title:ed.title,facilityType:ed.facilityType,applicationType:ed.applicationType,note:ed.note,sourceIds:[sourceId],requirements}},()=>doForm('requirements','addEdition',{title:ed.title,facilityType:ed.facilityType,applicationType:ed.applicationType,note:ed.note,['source:'+sourceId]:true,requirements:JSON.stringify(requirements,null,2)}));
   s=await state();const c=input('createCase');await op('case',4,{action:'createCase',input:{title:c.title,reference:'receiving-demo-case',details:c.details,editionId:s.editions[0].id}},()=>doForm('cases','createCase',{title:c.title,reference:'receiving-demo-case',details:c.details,editionId:s.editions[0].id}));
   for(const [revision,ref]of [[5,'person-a'],[6,'person-b']]){s=await state();await op(ref,revision,{action:'addSubject',input:{caseId:caseOf(s).id,label:'Example Person',role:'Demonstration applicant',reference:ref}},()=>doForm('cases','addSubject:'+caseOf(s).id,{label:'Example Person',role:'Demonstration applicant',reference:ref}));}
   await capture('01-distinct-subjects-desktop');return{step:'source-edition-case-and-distinct-subjects'};
  });
  await phase('complete-scope-original-forms-and-correction',async()=>{
   let s=await state(),c=caseOf(s),a=person(s,'person-a'),b=person(s,'person-b');const req='declaration',reason='Two separate declared people require separate instances.',note='Both distinct demonstration people are included.';
   await op('scope',7,{action:'setScope',input:{caseId:c.id,note,requirements:[{requirementId:req,subjectIds:[a.id,b.id],reason}]}},()=>doForm('scope','setScope:'+c.id,{['subject:'+req+':'+a.id]:true,['subject:'+req+':'+b.id]:true,['reason:'+req]:reason,note}));
   await op('create-instances-first',8,{action:'addInstance',input:{caseId:c.id,requirementId:req,subjectId:a.id}},()=>doForm('scope','addInstances:'+c.id,{}));
   await op('create-instances-second',9,{action:'addInstance',input:{caseId:c.id,requirementId:req,subjectId:b.id}},()=>{throw Error('Reopen the original atomic two-instance operation.');});
   s=await state();need(inst(s,'person-a')&&inst(s,'person-b')&&inst(s,'person-a').id!==inst(s,'person-b').id,'Both exact selected subject instances must be retained.');
   await keepFile('evidence-a',10);await keepFile('evidence-b',11);
   await setForm(await state(),'person-a',12,'Selected person A.',{role:'Director',date:'',active:'false'},'evidence-a');
   await setForm(await state(),'person-b',13,'Selected person B.',{role:'Nurse',date:'2026-10-12'},'evidence-b');
   s=await state();const ib=inst(s,'person-b');await op('review-b',14,{action:'reviewInstance',input:{instanceId:ib.id,outcome:'accepted',note:'Demonstration declaration and source fields reviewed.'}},async()=>{await nav(page,'forms');await page.locator('[data-instance-id='+attr(ib.id)+']').click();await submit(page,'reviewInstance:'+ib.id,{outcome:'accepted',note:'Demonstration declaration and source fields reviewed.'});});
   s=await state();c=caseOf(s);const ia=inst(s,'person-a'),round=input('openRound');
   await op('correction-request',15,{action:'openRound',input:{caseId:c.id,reference:round.reference,deadline:round.deadline,note:round.note}},()=>doForm('corrections','openRound:'+c.id,{reference:round.reference,deadline:round.deadline,note:round.note,['include:'+ia.id]:true,['field:'+ia.id]:'date',['request:'+ia.id]:round.items[0].request}));
   s=await state();const saved=s.rounds[0],item=saved.items[0];
   await op('partial-response',16,{action:'respond',input:{roundId:saved.id,itemId:item.id,message:'Partial response: document date still being checked.',fileIds:[]}},()=>doForm('corrections','respond:'+saved.id+':'+item.id,{message:'Partial response: document date still being checked.'}));
   s=await state();await op('partial-decision',17,{action:'decideResponse',input:{responseId:s.responses[0].id,outcome:'needs_correction',note:'Date remains absent.'}},()=>doForm('corrections','decideResponse:'+s.responses[0].id,{outcome:'needs_correction',note:'Date remains absent.'}));
   await capture('02-original-correction-and-partial-response');return{step:'complete-scope-original-forms-and-correction'};
  });
  await phase('revised-original-response-and-accepted-handover',async()=>{
   await keepFile('evidence-a2',18);await setForm(await state(),'person-a',19,'Revised signed declaration received in demonstration.',{role:'Director',date:'2026-10-13',active:'false'},'evidence-a2');
   let s=await state(),round=s.rounds[0],item=round.items[0],f=findFile(s,'evidence-a2');
   await op('complete-response',20,{action:'respond',input:{roundId:round.id,itemId:item.id,message:'Date and revised original demonstration file supplied.',fileIds:[f.id]}},()=>doForm('corrections','respond:'+round.id+':'+item.id,{message:'Date and revised original demonstration file supplied.',['responseFiles:'+f.id]:true}));
   s=await state();const response=s.responses.find(x=>x.message==='Date and revised original demonstration file supplied.');
   await op('complete-decision',21,{action:'decideResponse',input:{responseId:response.id,outcome:'accepted',note:'Current returned original and date reviewed.'}},()=>doForm('corrections','decideResponse:'+response.id,{outcome:'accepted',note:'Current returned original and date reviewed.'}));
   s=await state();const ia=inst(s,'person-a');await op('review-a',22,{action:'reviewInstance',input:{instanceId:ia.id,outcome:'accepted',note:'Complete current declaration reviewed.'}},async()=>{await nav(page,'forms');await page.locator('[data-instance-id='+attr(ia.id)+']').click();await submit(page,'reviewInstance:'+ia.id,{outcome:'accepted',note:'Complete current declaration reviewed.'});});
   s=await state();await op('complete-acceptance',23,{action:'acceptCase',input:{caseId:caseOf(s).id,note:'Complete demonstration packet accepted for handoff.'}},()=>doForm('handover','acceptCase:'+caseOf(s).id,{note:'Complete demonstration packet accepted for handoff.'}));
   need(caseOf(await state()).assessment.status==='accepted_for_handoff','The complete current demonstration handover must be accepted.');
   await capture('03-complete-accepted-handover-desktop');await page.setViewportSize({width:390,height:844});await capture('04-complete-accepted-handover-mobile');await page.setViewportSize({width:1440,height:1000});return{step:'revised-original-response-and-accepted-handover'};
  });
  await phase('actual-native-contract-export-and-bound-original-return',async()=>{
   await keepFile('contract-file',24);
   const makeContract=async(typed,revision)=>{
    const s=await state(),f=findFile(s,'contract-file'),original=fixture.journal.find(o=>o.action==='addNativeContract'&&o.input.id===(typed?'native-contract-typed':'native-contract')).input;
    await op('native-contract-'+revision,revision,{action:'addNativeContract',input:{caseId:caseOf(s).id,title:original.title,fileIds:[f.id],tables:original.tables,note:original.note}},()=>doForm('native','addNativeContract:'+caseOf(s).id,{title:original.title,['contractFiles:'+f.id]:true,tables:JSON.stringify(original.tables,null,2),lookups:'[]',note:original.note}));
   };
   const makeMapping=async(typed,revision)=>{
    const s=await state(),contract=s.nativeContracts.find(c=>c.title===(typed?'Complete typed demonstration native schema':'Demonstration native schema')),instances=[inst(s,'person-a'),inst(s,'person-b')],rows=instances.map(i=>({instanceId:i.id,columns:{row_id:{kind:'instance_id'},role:{kind:'field',fieldId:'role'},declared_on:{kind:'field',fieldId:'date'}}})),tables=[{table:'demo_declaration',expectedRows:2,rows}],note=typed?'Two complete demonstration records and explicit target types.':'Exact two-row explicit mapping.';
    const fields={tables:JSON.stringify(tables,null,2),note};for(const i of instances){fields['scope:'+i.id]='include';fields['reason:'+i.id]='Selected current declaration.';}
    await op('native-mapping-'+revision,revision,{action:'mapNative',input:{contractId:contract.id,tables,note}},()=>doForm('native','mapNative:'+contract.id,fields));
   };
   const makeReturn=async(typed,revision)=>{
    const s=await state(),contract=s.nativeContracts.find(c=>c.title===(typed?'Complete typed demonstration native schema':'Demonstration native schema')),m=s.nativeMappings.find(m=>m.contractId===contract.id),f=findFile(s,'native-return'),out=Engine.nativeExport((await record()).workspace,m.id),records=[inst(s,'person-a'),inst(s,'person-b')].map((i,index)=>({instanceId:i.id,table:'demo_declaration',targetId:index?'demo-b':'demo-a',outcome:'accepted',message:'Demonstration result.',rowId:out.rowBindings.find(row=>row.instanceId===i.id).rowId})),reference=typed?'demo-import-typed':'demo-import-1',note='Authored demonstration return; no external system invoked.';
    await op('native-return-'+revision,revision,{action:'recordNativeReturn',input:{mappingId:m.id,exportSha256:out.exportSha256,reference,outcome:'accepted',records}},()=>doForm('native','recordNativeReturn:'+m.id,{reference,outcome:'accepted',note,['returnFiles:'+f.id]:true,records:JSON.stringify(records,null,2)}));
   };
   await makeContract(false,25);await makeMapping(false,26);await keepFile('native-return',27);await makeReturn(false,28);await makeContract(true,29);await makeMapping(true,30);await makeReturn(true,31);await keepFile('byte-preservation',32);
   const rec=await record(),s=Engine.inspect(rec.workspace),typed=s.nativeMappings.find(m=>s.nativeContracts.find(c=>c.id===m.contractId)?.title==='Complete typed demonstration native schema'),out=Engine.nativeExport(rec.workspace,typed.id);
   need(out.ready&&out.rowBindings.length===2,'The accepted typed native export must retain both exact bound rows.');need(s.nativeReturns.at(-1).coverage.unreportedRowIds.length===0,'The original native return must cover its exact two prepared rows.');
   await nav(page,'native');await capture('05-native-contract-and-return-desktop');return{step:'actual-native-contract-export-and-bound-original-return',mappingId:typed.id,exportSha256:out.exportSha256,files:out.files};
  });

  const draftStage=await phase('unfinished-form-working-html-and-reload',async()=>{
   const s=await state(),i=inst(s,'person-a'),note='Unfinished receiving note — café, 東京, and an unsubmitted second line.\nKeep this whole draft through reopening.';
   await nav(page,'forms');await page.locator('[data-instance-id='+attr(i.id)+']').click();
   const form=page.locator('form[data-action='+attr('setInstance:'+i.id)+']');await form.locator('[name="reason"]').fill(note);
   const before=await record();need(before.drafts['setInstance:'+i.id]?.fields.reason===note,'The complete unfinished writing must be in the downloaded recovery record.');
   await nav(page,'workspace');const workingHTML=path.join(r.attempt,'Accepted_With_Unfinished_Draft.html'),recoveryFile=path.join(r.attempt,'Accepted_With_Unfinished_Draft.json');
   await download(page,page.locator('#top-working-html'),workingHTML);await original(recoveryFile,json(before));await add(workingHTML,'working-html');await add(recoveryFile,'complete-recovery');
   await page.reload();await ready(page);await nav(page,'forms');await page.locator('[data-instance-id='+attr(i.id)+']').click();
   need(await page.locator('form[data-action='+attr('setInstance:'+i.id)+'] [name="reason"]').inputValue()===note,'Reload must retain the actual unfinished form.');
   await capture('06-unfinished-form-reopened');return{step:'unfinished-form-working-html-and-reload',record:before,workingHTML,recoveryFile,note};
  });
  await phase('later-original-edit-keeps-historical-native-export',async()=>{
   let s=await state();await setForm(s,'person-a',33,'A later original declaration date was received after the accepted demonstration handover.',{role:'Director',date:'2026-10-14',active:'false'},'evidence-a2');
   const rec=await record();s=Engine.inspect(rec.workspace);const typed=s.nativeMappings.find(m=>s.nativeContracts.find(c=>c.id===m.contractId)?.title==='Complete typed demonstration native schema'),before=Engine.nativeExport(draftStage.record.workspace,typed.id),after=Engine.nativeExport(rec.workspace,typed.id);
   need(!caseOf(s).assessment.acceptanceCurrent&&!after.ready&&before.exportSha256===after.exportSha256&&JSON.stringify(before.files)===JSON.stringify(after.files),'The original accepted native CSV must remain intact after current acceptance becomes stale.');
   await nav(page,'native');await capture('07-stale-acceptance-retained-original-export');await page.setViewportSize({width:390,height:844});await capture('08-native-return-mobile');await page.setViewportSize({width:1440,height:1000});
   return{step:'later-original-edit-keeps-historical-native-export',originalExportSha256:before.exportSha256,retainedExportSha256:after.exportSha256,currentReady:after.ready};
  });
  await phase('independent-complete-working-html-receive-and-new-edit',async()=>{
   const other=await context.newPage();tabs.add(other);other.on('pageerror',onError);await other.setViewportSize({width:1440,height:1000});
   const childDir=path.join(path.dirname(draftStage.workingHTML),'independent-receiving');
   const childEngine={...receivingEngine,createWorkspace:()=>draftStage.record};
   const child=await openMigrationReceiving({page:other,outputDirectory:childDir,applicationPath:draftStage.workingHTML,engine:childEngine,title:'Independent original application packet receiving',resultFilename:'independent-result.json',workspaceModel,browserControls:{ready:'#workspace-revision',workspaceDownload:'#top-json',seedHTML,beforeCheckpoint}});
   if(child.completed){await add(path.join(childDir,'independent-result.json'),'independent-result');other.off('pageerror',onError);await other.close();tabs.delete(other);return child.completed;}
   try{
    await ready(other);await other.locator('#operator-name').fill('Receiving operator');const before=await child.checkpoint(),s=Engine.inspect(before.workspace),i=inst(s,'person-a');
    need(before.workspace.id===draftStage.record.workspace.id,'Independent receiving must keep the original logical workspace.');
    const reason='Independent receiver amended the original declaration after reopening the complete working HTML.';
    await child.mutation('independent-saved-amendment',33,{action:'setInstance',actor:'Receiving operator',input:{instanceId:i.id,applicability:'applies',reason,values:{role:'Director',date:'2026-10-15',active:'false'},evidenceIds:[findFile(s,'evidence-a2').id]}},async()=>{
     await nav(other,'forms');await other.locator('[data-instance-id='+attr(i.id)+']').click();const form=other.locator('form[data-action='+attr('setInstance:'+i.id)+']');await fill(form,{applicability:'applies',reason,'present:role':true,'value:role':'Director','present:date':true,'value:date':'2026-10-15','present:active':true,'value:active':'false'});await form.locator('button[type=submit]').click();
    });
    const final=await child.checkpoint();need(Engine.compareWorkspaces(draftStage.record.workspace,final.workspace).relationship==='incoming_descendant','The independent meaningful edit must extend the exact original journal.');
    await nav(other,'workspace');
    const outJson=path.join(child.attempt,'Independent_Recovery.json'),outHtml=path.join(child.attempt,'Independent_Working.html'),outZip=path.join(child.attempt,'Independent_Complete.zip');
    await download(other,other.locator('#top-json'),outJson);await download(other,other.locator('#top-working-html'),outHtml);await download(other,other.locator('#top-zip'),outZip);
    for(const f of [outJson,outHtml,outZip])await add(f,'independent-portable-output');
    await capture('09-independent-reopened-and-edited',other);
    const result=await child.finish({schema:'commons.application-packet-independent-receiving.v1',state:'completed',workspaceId:final.workspace.id,revision:final.workspace.journal.length,meaningfulEdit:final.workspace.journal.at(-1)});
    await add(path.join(childDir,'independent-result.json'),'independent-result');return result;
   }finally{await child.close();other.off('pageerror',onError);await other.close();tabs.delete(other);}
  });
  await phase('same-copy-two-tab-conflict-and-complete-draft-recovery',async()=>{
   // Each real attempt retains its own initial revision. A lost browser cannot recreate a
   // vanished stale in-memory view: retain that attempt, then operate a following pair on
   // this same workspace. Completed saved branches are adopted before another mutation.
   const marker='Receiving peer complete unfinished note — Ångström / 東京.';
   const branches=()=>page.evaluate(async()=>{
    const db=await new Promise((res,rej)=>{const q=indexedDB.open('application-packet-workspace-v1',1);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
    try{return await new Promise((res,rej)=>{const q=db.transaction('branches').objectStore('branches').getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}finally{db.close();}
   });
   let retained=(await branches()).find(b=>b.copyId===r.intent.copyId&&Object.values(b.drafts||{}).some(d=>d.fields?.details===marker));
   if(!retained){
    const base=await record(),s=Engine.inspect(base.workspace),c=caseOf(s),revision=base.workspace.journal.length,peer=await context.newPage();tabs.add(peer);peer.on('pageerror',onError);await peer.setViewportSize({width:1440,height:1000});await peer.goto(pathToFileURL(path.join(r.root,'original-programme.html')).href);await ready(peer);await peer.locator('#operator-name').fill('Receiving peer');
    try{
     await nav(peer,'cases');const peerForm=peer.locator('form[data-action='+attr('updateCase:'+c.id)+']');await fill(peerForm,{title:c.title,reference:c.reference,details:marker,reason:'A concurrent receiving note remains complete.'});
     const cycle=await original(path.join(r.attempt,'cas-original-'+revision+'.json'),json({schema:'commons.application-packet-cas-receiving.v1',copyId:r.intent.copyId,base:base.workspace,peerDraft:{details:marker},plannedSequence:revision+1}));await add(cycle,'original-cas-intent');
     const details='Current receiving operator saved complete case facts at original revision '+revision+'.';
     await op('two-tab-current-'+revision,revision+1,{action:'updateCase',actor:'Receiving operator',input:{caseId:c.id,title:c.title,reference:c.reference,details,reason:'Actual same-copy competing writer receiving.'}},()=>doForm('cases','updateCase:'+c.id,{title:c.title,reference:c.reference,details,reason:'Actual same-copy competing writer receiving.'}));
     await peerForm.locator('button[type=submit]').click();await peer.getByRole('heading',{name:'Two complete versions are retained',exact:true}).waitFor();
     const conflictFile=path.join(r.attempt,'Two_Complete_Versions_And_Drafts.json');
     const bytes=await download(peer,peer.getByRole('button',{name:'Download both versions and draft values',exact:true}),conflictFile),conflict=JSON.parse(bytes);
     need(conflict.base.journal.length===revision&&conflict.current.journal.length===revision+1&&conflict.candidate.journal.length===revision+1&&Object.values(conflict.drafts).some(d=>d.fields.details===marker),'The actual conflict must retain both complete branches and all peer writing.');
     await add(conflictFile,'complete-conflict');retained=conflict;await capture('10-two-tab-complete-conflict',peer);
     await peer.setViewportSize({width:390,height:844});await capture('11-two-tab-conflict-mobile',peer);
     await peer.getByRole('button',{name:'Continue my version as a new copy',exact:true}).click();await ready(peer);
     need(await peer.locator('#identity').getAttribute('data-copy-id')!==r.intent.copyId,'Conflict recovery must preserve the saved original copy.');
     await nav(peer,'cases');need(await peer.locator('form[data-action='+attr('updateCase:'+c.id)+'] [name="details"]').inputValue()===marker,'The recovered complete peer version must retain its meaningful note.');
     await nav(peer,'workspace');const recovered=path.join(r.attempt,'Recovered_Peer_Copy.json');await download(peer,peer.locator('#top-json'),recovered);await add(recovered,'recovered-peer-copy');
    }finally{peer.off('pageerror',onError);await peer.close();tabs.delete(peer);}
   }else{
    const file=await original(path.join(r.attempt,'Adopted_Original_Conflict.json'),json(retained));await add(file,'adopted-original-conflict');
   }
   need(retained&&retained.current&&retained.candidate,'Keep the original actual two-tab result.');return{step:'same-copy-two-tab-conflict-and-complete-draft-recovery',savedRevision:retained.current.journal.length,candidateRevision:retained.candidate.journal.length,originalCopyId:r.intent.copyId};
  });
  await phase('complete-zip-original-bytes-report-and-reopen',async()=>{
   await nav(page,'workspace');const files={recovery:path.join(r.attempt,'Final_Recovery.json'),html:path.join(r.attempt,'Final_Working.html'),zip:path.join(r.attempt,'Final_Complete.zip')};
   await download(page,page.locator('#top-json'),files.recovery);await download(page,page.locator('#top-working-html'),files.html);const bytes=await download(page,page.locator('#top-zip'),files.zip);
   for(const file of Object.values(files))await add(file,'complete-final-product');
   const rec=Portable.parseRecovery(await fs.readFile(files.recovery,'utf8')),members=unzipStored(bytes),expected=Portable.completeFiles(boot.source,rec);
   need(members.size===expected.length,'The actual complete ZIP must contain every selected source, original, report and working member.');
   const opened=[];
   for(const entry of expected){
    const body=entry.base64!==undefined?Buffer.from(entry.base64,'base64'):Buffer.from(entry.content,'utf8');need(members.get(entry.path)?.equals(body),'Actual ZIP bytes differ from their complete original: '+entry.path);
    const target=await original(within(path.join(r.attempt,'opened-complete'),entry.path),body);opened.push({path:entry.path,bytes:body.length,sha256:sha(body)});await add(target,'opened-zip-member');
   }
   const binary=Engine.inspect(rec.workspace).files.find(f=>f.filename==='original-byte-preservation.bin');need(binary&&Buffer.from(binary.base64,'base64').equals(Buffer.from(Array.from({length:256},(_,i)=>i))),'Every original byte 0..255 must survive receiving.');
   const reportTab=await context.newPage();tabs.add(reportTab);reportTab.on('pageerror',onError);await reportTab.setViewportSize({width:1440,height:1000});await reportTab.goto(pathToFileURL(path.join(r.attempt,'opened-complete','Packet_Review.html')).href);
   await capture('12-complete-report-desktop',reportTab);await reportTab.setViewportSize({width:390,height:844});await capture('13-complete-report-mobile',reportTab);await reportTab.setViewportSize({width:1440,height:1000});await reportTab.emulateMedia({media:'print'});await capture('14-complete-report-print',reportTab);
   if(typeof reportTab.pdf==='function'){const pdf=path.join(r.attempt,'Complete_Packet_Review.pdf');await reportTab.pdf({path:pdf,format:'A4',printBackground:true});await add(pdf,'complete-report-pdf');}
   const originalLinks=await reportTab.locator('a[href^="originals/"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
   for(const href of originalLinks){const member=decodeURIComponent(href);need(members.has(member),'Every visible original-file report link must resolve to the exact package.');}
   await reportTab.close();tabs.delete(reportTab);
   const openedJson=Engine.importWorkspace(members.get('workspace.json').toString('utf8'));need(Engine.compareWorkspaces(rec.workspace,openedJson).relationship==='identical','The downloaded ZIP journal must reopen exactly.');
   return{step:'complete-zip-original-bytes-report-and-reopen',files,openedMembers:opened,workspaceId:rec.workspace.id,revision:rec.workspace.journal.length};
  });
  await phase('every-exact-outgoing-attachment-opened',async()=>{
   need(Array.isArray(attachments),'Select the actual complete outgoing attachments.');
   const selected=[];
   for(let n=0;n<attachments.length;n++){
    const entry=attachments[n];need(entry&&path.isAbsolute(entry.path)&&typeof entry.sha256==='string'&&Number.isSafeInteger(entry.bytes),'Bind each actual attachment to its complete selected bytes.');
    const stat=await fs.lstat(entry.path);need(stat.isFile()&&!stat.isSymbolicLink(),'Open each complete ordinary attachment.');const bytes=await fs.readFile(entry.path);
    need(bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'The exact outgoing attachment changed: '+entry.path);
    const basename=path.basename(entry.path),saved=await original(path.join(r.attempt,'outgoing-originals',String(n+1)+'-'+basename),bytes);await add(saved,'exact-outgoing-original');
    const tab=await context.newPage();tabs.add(tab);tab.on('pageerror',onError);await tab.setViewportSize({width:1440,height:1000});
    try{
     const parsed=/\.json$/i.test(basename)?JSON.parse(bytes.toString('utf8')):null;
     const workspaceJSON=parsed&&(parsed.schema===Engine.SCHEMA||parsed.schema===Portable.RECOVERY_SCHEMA);
     if(workspaceJSON){
      const supplied=Portable.parseRecovery(bytes.toString('utf8'));await tab.goto(pathToFileURL(appPath).href);await tab.locator('input[type=file]').first().waitFor();await tab.locator('input[type=file]').first().setInputFiles(saved);await ready(tab);
      need(await tab.locator('#workspace-revision').innerText()==='Revision '+supplied.workspace.journal.length,'Open the actual supplied reference workspace through the real receiver.');
      for(const section of ['sources','requirements','cases','scope','history']){
       await nav(tab,section);await capture('attachment-'+(n+1)+'-'+section+'-desktop',tab);await tab.setViewportSize({width:390,height:844});await capture('attachment-'+(n+1)+'-'+section+'-mobile',tab);await tab.setViewportSize({width:1440,height:1000});
      }
      await nav(tab,'workspace');const received=path.join(r.attempt,'Received_Attachment_'+(n+1)+'.json'),receivedZIP=path.join(r.attempt,'Received_Attachment_'+(n+1)+'.zip');
      const recoveredBytes=await download(tab,tab.locator('#top-json'),received),recovered=Portable.parseRecovery(recoveredBytes.toString('utf8'));
      need(Engine.compareWorkspaces(supplied.workspace,recovered.workspace).relationship==='identical','The actual complete reference journal must reopen without invented decisions.');
      const zipped=await download(tab,tab.locator('#top-zip'),receivedZIP),memberMap=unzipStored(zipped);
      for(const f of Engine.buildHandover(supplied.workspace)){const body=f.base64!==undefined?Buffer.from(f.base64,'base64'):Buffer.from(f.content);need(memberMap.get(f.path)?.equals(body),'The incoming reference workspace lost an original member: '+f.path);}
      await add(received,'actual-reference-reopened');await add(receivedZIP,'actual-reference-complete-archive');
      await tab.emulateMedia({media:'print'});await capture('attachment-'+(n+1)+'-received-print',tab);
     }else if(/\.html?$/i.test(basename)){
      await tab.goto(pathToFileURL(saved).href);
      if(bytes.equals(appBytes))await tab.locator('input[type=file]').first().waitFor();else await tab.locator('body').waitFor();
      await capture('attachment-'+(n+1)+'-desktop',tab);await tab.setViewportSize({width:390,height:844});await capture('attachment-'+(n+1)+'-mobile',tab);await tab.setViewportSize({width:1440,height:1000});await tab.emulateMedia({media:'print'});await capture('attachment-'+(n+1)+'-print',tab);
     }else if(parsed){
      const text=bytes.toString('utf8');for(let start=0;start<text.length||start===0;start+=12000){
       await viewText(tab,basename+' — original text '+start+' through '+Math.min(start+12000,text.length),text.slice(start,start+12000));await capture('attachment-'+(n+1)+'-text-part-'+(1+start/12000),tab);
      }
     }else throw Error('Open this exact selected attachment through its actual normal viewer in the original programme: '+basename);
     selected.push({name:basename,bytes:bytes.length,sha256:sha(bytes)});
    }finally{tab.off('pageerror',onError);await tab.close();tabs.delete(tab);}
   }
   return{step:'every-exact-outgoing-attachment-opened',selected};
  });
  const final=await record();for(const [name,item]of Object.entries(r.state.phases))if(item.state==='COMPLETE')steps.push({step:name,state:'completed'});
  need(errors.length===0,'Resolve actual browser page errors before completing the original programme.');
  return await r.finish({schema:'commons.application-packet-browser.v1',state:'completed',selectedInputs,workspaceId:final.workspace.id,revision:final.workspace.journal.length,steps,outputs,screenshots:screens,pageErrors:errors,visualReview:{required:'The producing peer opens and looks at these exact captures, each report page and the actual attachments; record that observation in the original programme.',viewports:[{width:1440,height:1000},{width:390,height:844}]}});

 }finally{page.off('pageerror',onError);for(const tab of tabs)await tab.close().catch(()=>{});await r.close();}
}
