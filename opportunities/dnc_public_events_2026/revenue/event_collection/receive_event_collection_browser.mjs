import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const need=(value,message)=>{if(!value)throw new Error(message);};
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const escape=value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function readMaybe(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){const raw=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,raw,{flag:'wx'});await fs.rename(temp,file);}

/** One original isolated-cloud page; no server, model, CMS or browser process is started. */
export async function receiveEventCollectionBrowser({page,directory,source,operationId='public-event-collection-receiving'}) {
  await fs.mkdir(directory,{recursive:true});
  const operationFile=path.join(directory,'operation.json');
  let journal=await readMaybe(operationFile);
  const originalViewport=page.viewportSize();
  const snapshot=()=>page.evaluate(()=>window.eventCollectionDesk.snapshot());
  const modelRead=(name,...args)=>page.evaluate(({name,args})=>window.eventCollectionDesk.model[name](...args),{name,args});
  await page.waitForFunction(()=>window.eventCollectionDesk);
  const modelSourceId=await modelRead('snapshot',source).then(x=>x.id);
  let ws=await snapshot();
  if(journal)need(journal.operation_id===operationId&&journal.workspace_id===ws.id&&journal.source_id===modelSourceId,'The receiving directory belongs to another original collection or source.');
  else {
    journal={schema:'tjlabs.public-event-browser-receiving/v1',operation_id:operationId,workspace_id:ws.id,source_id:modelSourceId,started_at:new Date().toISOString(),chapters:{},downloads:[],screenshots:[],original_workspace:ws};
    await save(operationFile,journal);
  }
  const record=()=>save(operationFile,journal);
  const settle=async({allowError=false}={})=>{
    await page.waitForFunction(()=>window.eventCollectionDesk&&[...document.querySelectorAll('#app nav button')].some(b=>!b.disabled),null,{timeout:120000});
    if(!allowError){const error=page.locator('#app [role=alert]');if(await error.count())need(!(await error.textContent()).trim(),'Application returned: '+await error.textContent());}
  };
  const tab=async name=>{await page.locator('[data-tab="'+name+'"]').click();await settle();};
  const click=async(action,options={})=>{await page.locator('[data-action="'+action+'"]').click();await settle(options);};
  const actor=async()=>{await page.locator('#actor').fill('TJLabs authored receiving '+operationId);};
  const files=new Map();
  async function retainDownload(value,label) {
    const failure=await value.failure();need(!failure,'Download failed: '+failure);
    const folder=path.join(directory,'downloads');await fs.mkdir(folder,{recursive:true});
    const temp=path.join(folder,'.receiving-'+crypto.randomUUID()+'.tmp');await value.saveAs(temp);
    const bytes=await fs.readFile(temp),sha256=hash(bytes),filename=label+'-'+sha256+'-'+path.basename(value.suggestedFilename()),destination=path.join(folder,filename);
    try {await fs.writeFile(destination,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const previous=await fs.readFile(destination);need(previous.equals(bytes),'An immutable download path already has different bytes.');}
    await fs.unlink(temp);
    const entry={label,filename,path:destination,bytes:bytes.length,sha256};
    journal.downloads.push(entry);files.set(label,{...entry,content:bytes.toString('utf8')});await record();return files.get(label);
  }
  async function download(action,label,selector) {
    const button=page.locator(selector||'[data-action="'+action+'"]');
    const [value]=await Promise.all([page.waitForEvent('download'),button.click()]);
    return retainDownload(value,label);
  }
  async function screenshot(label) {
    const file=path.join(directory,'screenshots',label+'.png');await fs.mkdir(path.dirname(file),{recursive:true});await page.screenshot({path:file,fullPage:true});journal.screenshots.push({label,path:file});await record();
  }
  async function views(label) {
    await page.setViewportSize({width:1440,height:1000});await screenshot(label+'-desktop');
    await page.setViewportSize({width:390,height:844});await screenshot(label+'-phone');
    await page.setViewportSize({width:1440,height:1000});
  }
  async function chapter(name,body) {
    if(journal.chapters[name]?.completed_at)return;
    journal.active_chapter=name;await record();
    await body();
    const current=await snapshot();
    journal.chapters[name]={completed_at:new Date().toISOString(),revision:current.revision,seal:current.seal};
    await save(path.join(directory,'chapters',name+'.json'),{workspace:current,chapter:journal.chapters[name]});
    await record();
  }
  async function selectSource(incoming) {
    await tab('receive');const current=await snapshot();
    const wanted=await modelRead('snapshot',incoming);
    if(current.pending?.snapshot?.id!==wanted.id) {
      const file=path.join(directory,'inputs',wanted.id+'.json');await save(file,incoming);
      await page.locator('#source-file').setInputFiles(file);await settle();
    }
  }
  async function applySource(incoming,choices={}) {
    await selectSource(incoming);
    for(const [key,value] of Object.entries(choices))await page.locator('[data-choice="'+key+'"]').selectOption(value);
    await page.locator('#receive-note').fill('Authored receiving choices; complete original public records remain retained.');
    await actor();await click('apply-source');
  }
  async function saveTarget(target) {
    await tab('publish');
    await page.locator('#target-form textarea[name=target]').fill(JSON.stringify(target,null,2));
    await page.locator('#target-form [name=name]').fill(target.name);
    await page.locator('#target-form [name=adapter]').selectOption(target.adapter);
    await page.locator('#target-form [name=timezone]').fill(target.timezone||'');
    await page.locator('#target-form [name=id]').fill(target.id||'');
    await actor();await click('save-target');
  }
  async function preparedFiles(label) {
    await click('export');
    const current=await snapshot();
    const prepared=await page.evaluate(({workspace,generatedAt})=>window.eventCollectionDesk.exporter.buildExport(workspace,{format:workspace.target.adapter==='icalendar'?'ical':workspace.target.adapter,entryIds:workspace.entries.filter(e=>e.disposition==='active').map(e=>e.id),generatedAt,target:workspace.target}),{workspace:current,generatedAt:'2026-10-13T19:20:00Z'});
    const buttons=page.locator('[data-action=download-export]'),downloads=[];
    need(await buttons.count()===prepared.files.length,'Rendered export file count differs from the actual adapter.');
    for(let i=0;i<await buttons.count();i++) {
      const got=await download(null,label+'-'+i,'[data-action=download-export][data-file="'+i+'"]');
      downloads.push(got);
      if(got.filename.endsWith('.json')) {
        const p=JSON.parse(got.content);need(p.workspace.seal===current.seal,'Downloaded projection uses another working revision.');
        const restored=await modelRead('openArchive',JSON.stringify(p.archive));need(restored.seal===current.seal,'Complete companion did not cold-read through the original model.');
        need(p.selected_ids.length===current.entries.filter(e=>e.disposition==='active').length,'Selected original entries were lost from the export.');
        journal[label]={selected:p.selected_ids.length,exported:p.exported_ids.length,omitted:p.omitted_ids.length,issues:p.issues,workspace_seal:p.workspace.seal};
      }
    }
    const complete=downloads.find(f=>f.filename.endsWith('.json')),actual=JSON.parse(complete.content);
    const expected=await page.evaluate(({workspace,generatedAt})=>window.eventCollectionDesk.exporter.buildExport(workspace,{format:workspace.target.adapter==='icalendar'?'ical':workspace.target.adapter,entryIds:workspace.entries.filter(e=>e.disposition==='active').map(e=>e.id),generatedAt,target:workspace.target}),{workspace:current,generatedAt:actual.generated_at});
    for(const member of expected.files){const downloaded=downloads.find(f=>f.filename.endsWith('-'+member.name));need(downloaded&&downloaded.content===member.content,'Downloaded '+member.name+' differs from its exact saved model projection.');}
    await views(label+'-review');await record();return downloads;
  }
  const editionTitle='Before authored receiving '+operationId;
  try {
    await chapter('original-cohort',async()=>{
      let current=await snapshot();
      if(!current.snapshots.some(s=>s.id===modelSourceId))await applySource(source);
      current=await snapshot();need(current.snapshots.some(s=>s.id===modelSourceId),'Original source is missing after receiving.');
      need(current.entries.length===source.records.length,'The complete original cohort count differs.');
      await tab('editions');
      if(!current.editions.some(e=>e.title===editionTitle)) {await page.locator('[name=edition-title]').fill(editionTitle);await actor();await click('save-edition');}
      const archive=await download('download-archive','original');
      const reopened=await modelRead('openArchive',archive.content);need(reopened.entries.length===source.records.length,'Original archive lost records.');
      await tab('collection');await views('original-collection');
      await page.locator('[name=search]').fill('no-matching-event-'+operationId);need((await page.locator('#app').textContent()).includes('0 matching records'),'Empty search is not visible.');await screenshot('empty-search');
      await page.locator('[name=search]').fill('');
    });
    const initial=journal.original_workspace.entries.length?journal.original_workspace:await snapshot();
    const first=initial.entries[0]|| (await snapshot()).entries[0];
    const localTitle=(first.current.title||'Original event')+' — authored local receiving';
    await chapter('local-edit',async()=>{
      const current=await snapshot(),entry=current.entries.find(e=>e.id===first.id);
      if(entry.current.title!==localTitle) {
        await tab('collection');await page.locator('[name=search]').fill(entry.record_key);
        await page.locator('[data-action=edit][data-entry="'+entry.id+'"]').click();await settle();
        await page.locator('#entry-form [name=title]').fill(localTitle);await actor();await click('save-entry');
      }
      need((await snapshot()).entries.find(e=>e.id===first.id).current.title===localTitle,'Actual editor did not save attributed local title.');
      await views('edited-original');
    });
    const successor=clone(source);delete successor.id;
    successor.source={...successor.source,format:'authored-browser-successor',retrieved_at:journal.started_at,coverage:'partial'};
    successor.records=[clone(source.records.find(r=>r.key===first.record_key))];
    successor.records[0].values={title:(first.current.title||'Original event')+' — authored incoming source'};
    successor.records[0].observed_fields=['title'];
    successor.records[0].original={kind:'authored receiving title successor',retained_original:successor.records[0].original};
    await chapter('source-conflict',async()=>{
      const sid=(await modelRead('snapshot',successor)).id,current=await snapshot();
      if(!current.snapshots.some(s=>s.id===sid)||current.entries.find(e=>e.id===first.id).baseline.title!==successor.records[0].values.title) {
        await selectSource(successor);
        await page.locator('[data-choice="'+first.id+':title"]').selectOption('LOCAL');
        await page.locator('#receive-note').fill('Keep authored local title; preserve every original source field and unobserved row.');
        await click('save-receiving');
        await page.reload();await settle();await tab('receive');
        need(await page.locator('[data-choice="'+first.id+':title"]').inputValue()==='LOCAL','Saved conflict choice did not survive the original page reload.');
        await views('three-way-source-review');await actor();await click('apply-source');
      }
      const after=await snapshot();need(after.entries.find(e=>e.id===first.id).current.title===localTitle,'Source receive overwrote the selected local title.');
      need(after.entries.length===source.records.length&&after.entries.every(e=>e.disposition==='active'),'Partial incoming source removed another original record.');
    });
    const timed=(await snapshot()).entries.find(e=>e.current.schedule?.kind==='timed'&&e.current.schedule.start&&e.current.schedule.end);
    need(timed,'This original public cohort has no complete timed record for the receiving choice.');
    const timedSource=clone(source);delete timedSource.id;timedSource.source={...timedSource.source,format:'authored-browser-timezone-choice',retrieved_at:journal.started_at,coverage:'partial'};
    const originalTimed=source.records.find(r=>r.key===timed.record_key);
    timedSource.records=[{...clone(originalTimed),values:{schedule:{...clone(originalTimed.values.schedule),timezone:'America/Los_Angeles',literal:originalTimed.values.schedule.literal+' · authored receiving timezone choice'}},observed_fields:['schedule'],original:{kind:'authored operator timezone choice; not an observed source timezone',retained_original:clone(originalTimed.original)}}];
    await chapter('calendar-choice-and-exports',async()=>{
      const sid=(await modelRead('snapshot',timedSource)).id;
      if(!(await snapshot()).snapshots.some(s=>s.id===sid))await applySource(timedSource,{});
      const review={adapter:'event-csv',id:'original-review',name:'Complete original review',mapping:{title:'Title',schedule:'Complete schedule',venue:'Complete venue',organizers:'Complete organizers',categories:'Categories'},timezone:null};
      await saveTarget(review);await preparedFiles('review-csv');
      const calendar={adapter:'icalendar',id:'original-calendar',name:'Resolved original calendar occurrences',mapping:{},timezone:null,entry_mappings:{}};
      await saveTarget(calendar);const downloads=await preparedFiles('calendar');
      const ics=downloads.find(f=>f.filename.endsWith('.ics'));
      need(ics&&ics.content.includes('BEGIN:VEVENT')&&ics.content.includes('X-TJLABS-SOURCE-TIMEZONE:America/Los_Angeles'),'Calendar did not retain the explicit authored timezone interpretation.');
      const mapping=await page.evaluate(()=>window.eventCollectionDesk.exporter.TEC_FIELD_MAPPING);
      const target={adapter:'tec-csv',id:'authored-tec-mapping',name:'Reviewed target mapping course',timezone:'America/Los_Angeles',timezone_policy:'preserve',mapping:{...mapping,editorial_summary:null,media:null,venue:null,organizers:null,categories:null,event_url:null},entry_mappings:{}};
      await saveTarget(target);const tec=await preparedFiles('tec-csv');
      const csv=tec.find(f=>f.filename.endsWith('.csv'));need(csv&&!csv.content.split('\r\n')[0].includes('Event Featured Image'),'An omitted target field became an empty import column.');
    });
    await chapter('two-tabs-and-original-recovery',async()=>{
      const pairs=await page.evaluate(()=>window.eventCollectionDesk.storage.preserved());
      const originalPair=pairs.find(pair=>{try{return pair.reason==='concurrent-change'&&JSON.parse(pair.local).workspace.editions.some(e=>e.title==='Retained second-tab edition '+operationId);}catch{return false;}});
      if(originalPair) {
        const shared=await page.evaluate(()=>window.eventCollectionDesk.storage.read());
        need(shared===originalPair.shared,'The original compared shared version has changed; reconcile the retained pair before continuing.');
        await tab('recovery');await download('download-preserved','preserved-originals');
        journal.reused_concurrent_pair_id=originalPair.id;await views('recovery');await record();return;
      }
      const second=await page.context().newPage();
      try {
        await second.goto(page.url());await second.waitForFunction(()=>window.eventCollectionDesk);
        await tab('editions');const beforeSave=await snapshot(),firstTitle=beforeSave.editions.some(e=>e.title==='First-tab edition '+operationId)?'First-tab continuation '+operationId+' revision '+beforeSave.revision:'First-tab edition '+operationId;await page.locator('[name=edition-title]').fill(firstTitle);await actor();await click('save-edition');
        await second.locator('[data-tab=editions]').click();await second.locator('[name=edition-title]').fill('Retained second-tab edition '+operationId);
        await second.locator('[data-action=save-edition]').click();
        await second.waitForFunction(()=>document.querySelector('[data-action=choose-shared]'));
        const conflictDownload=async(selector,label)=>{
          const [value]=await Promise.all([second.waitForEvent('download'),second.locator(selector).click()]);
          const retained=await retainDownload(value,label);return JSON.parse(retained.content);
        };
        const retained=await conflictDownload('[data-action=download-local-conflict]','second-tab-retained');
        need(retained.workspace.editions.some(e=>e.title==='Retained second-tab edition '+operationId),'Concurrent save lost the actual attempted edition.');
        await second.locator('[data-action=choose-shared]').click();await second.waitForFunction(()=>!document.querySelector('[data-action=choose-shared]'));
        const current=await snapshot(),shared=await second.evaluate(()=>window.eventCollectionDesk.snapshot());need(current.seal===shared.seal,'Explicit shared selection changed the original accepted collection.');
      }finally{await second.close();}
      await tab('recovery');await download('download-preserved','preserved-originals');await views('recovery');
    });
    await chapter('unreadable-original-recovery',async()=>{
      let original,broken,validPath;
      if(journal.unreadable_recovery) {
        const retained=journal.unreadable_recovery;
        const bytes=await fs.readFile(retained.original.path);need(bytes.length===retained.original.bytes&&hash(bytes)===retained.original.sha256,'The retained original repair archive changed.');
        original=bytes.toString('utf8');validPath=retained.original.path;
        const damaged=await fs.readFile(retained.broken.path);need(damaged.length===retained.broken.bytes&&hash(damaged)===retained.broken.sha256,'The retained authored unreadable value changed.');broken=damaged.toString('utf8');
      } else {
        await tab('editions');const valid=await download('download-archive','before-unreadable-recovery');
        original=valid.content;validPath=valid.path;
        broken=JSON.stringify({...JSON.parse(original),schema:'authored-unreadable-archive-schema'});
        const brokenPath=path.join(directory,'inputs','authored-unreadable-original.txt');await save(brokenPath,broken);
        journal.unreadable_recovery={original:{path:valid.path,bytes:valid.bytes,sha256:valid.sha256},broken:{path:brokenPath,bytes:Buffer.byteLength(broken),sha256:hash(broken)}};
        await record(); // Save the complete repair source before the deliberate owned interruption.
      }
      const raw=await page.evaluate(()=>window.eventCollectionDesk.storage.read());
      if(raw===original&&!journal.unreadable_recovery.repaired_at) {
        const pairs=await page.evaluate(()=>window.eventCollectionDesk.storage.preserved());
        if(pairs.some(p=>p.reason==='explicit-recovery'&&p.shared===broken&&p.expected===broken&&p.local===original)){journal.unreadable_recovery.repaired_at=new Date().toISOString();journal.unreadable_recovery.recovered_completed_repair=true;await record();}
      }
      if(raw===original&&!journal.unreadable_recovery.repaired_at) {
        const result=await page.evaluate(async({original,broken,id})=>window.eventCollectionDesk.storage.compareSave(original,broken,{id,at:new Date().toISOString()},{preserveOriginal:true}),{original,broken,id:operationId+'-authored-storage-interruption'});
        need(result.saved,'The source changed before the owned unreadable-original course.');
      } else need(raw===broken||(raw===original&&journal.unreadable_recovery.repaired_at),'Another saved value replaced the original recovery pair; inspect it before continuing this same course.');
      if(raw!==original||!journal.unreadable_recovery.repaired_at) {
        await page.reload();await page.waitForFunction(()=>document.querySelector('#repair-file'));await settle();
        const actual=await download('download-raw','unreadable-original');
        need(actual.content===broken,'Unreadable original download changed its exact saved bytes.');
        await views('unreadable-original-recovery');
        await page.locator('#repair-file').setInputFiles(validPath);await settle();
        const recovered=await snapshot(),expected=await modelRead('openArchive',original);
        need(recovered.seal===expected.seal,'Explicit complete repair did not restore the original collection.');
        journal.unreadable_recovery.repaired_at=new Date().toISOString();await record();
      }
      await tab('recovery');const preserved=await download('download-preserved','all-preserved-after-repair');
      need(JSON.parse(preserved.content).records.some(r=>r.shared===broken),'Recovery archive lost the unreadable saved original.');
      await views('repaired-original');
    });
    await chapter('complete-archive-and-working-html',async()=>{
      await tab('editions');if(!(await snapshot()).editions.some(e=>e.title==='Complete authored receiving '+operationId)){await page.locator('[name=edition-title]').fill('Complete authored receiving '+operationId);await actor();await click('save-edition');}
      const archive=await download('download-archive','final-archive');
      const html=await download('download-html','final-working-html');
      const reopened=await modelRead('openArchive',archive.content),current=await snapshot();
      need(reopened.seal===current.seal&&reopened.snapshots.some(s=>s.id===modelSourceId),'Full outgoing archive lost the current or original source.');
      journal.final_archive=archive;delete journal.final_archive.content;journal.final_html=html;delete journal.final_html.content;await record();
      const browser=page.context().browser();need(browser,'The original receiver must supply a browser that supports an independent context.');
      const cold=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
      try {
        const p=await cold.newPage(),url='https://tjlabs-event-receiving.invalid/current.html';
        const htmlBytes=await fs.readFile(html.path,'utf8');
        await cold.route('**/*',route=>route.request().url()===url?route.fulfill({status:200,contentType:'text/html',body:htmlBytes}):route.abort());
        await p.goto(url);await p.waitForFunction(()=>window.eventCollectionDesk);
        const received=await p.evaluate(()=>window.eventCollectionDesk.snapshot());need(received.seal===current.seal,'Portable HTML did not cold-receive the complete saved model.');
        await p.locator('[data-tab=editions]').click();
        await p.locator('#archive-file').setInputFiles(archive.path);
        await p.waitForFunction(()=>[...document.querySelectorAll('nav button')].some(b=>!b.disabled));
        const same=await p.evaluate(()=>window.eventCollectionDesk.snapshot());need(same.seal===current.seal,'Actual archive input altered the received saved collection.');
        for(const [label,viewport]of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]) {await p.setViewportSize(viewport);const file=path.join(directory,'screenshots','cold-reopen-'+label+'.png');await p.screenshot({path:file,fullPage:true});journal.screenshots.push({label:'cold-reopen-'+label,path:file});}
        const attachment=await cold.newPage();
        for(let index=0;index<journal.downloads.length;index++) {
          const item=journal.downloads[index];if(item.path===html.path)continue;
          const body=await fs.readFile(item.path);need(hash(body)===item.sha256&&body.length===item.bytes,'Saved attachment bytes changed.');
          const attachmentUrl='https://tjlabs-event-receiving.invalid/attachment-'+index;
          await cold.route(attachmentUrl,route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>'+escape(item.label)+'</title><style>body{color:#151515;background:#fff;font:15px system-ui;margin:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:20px}</style><h1>'+escape(item.label)+'</h1><pre>'+escape(body.toString('utf8'))+'</pre>'}));
          await attachment.goto(attachmentUrl);
          const file=path.join(directory,'screenshots','attachment-'+index+'.png');await attachment.screenshot({path:file,fullPage:false});journal.screenshots.push({label:'attachment-'+item.label,path:file});
        }
      }finally{await cold.close();}
    });
    journal.completed_at=new Date().toISOString();delete journal.active_chapter;await record();
    return journal;
  }catch(error){journal.last_error={message:error.message,at:new Date().toISOString()};await record();throw error;}
  finally{if(originalViewport)await page.setViewportSize(originalViewport);}
}
