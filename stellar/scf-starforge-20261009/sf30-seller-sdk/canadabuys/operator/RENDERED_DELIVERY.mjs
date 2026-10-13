// MIT. Continue the original browser case through its outgoing saved views and files.
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const need = (value, message) => { if (!value) throw new Error(message); };
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr = value => JSON.stringify(String(value));
async function atomic(path, value) {
  const tmp=path+'.'+randomUUID()+'.tmp', file=await open(tmp,'wx',0o600);
  try { await file.writeFile(JSON.stringify(value,null,2)+'\n'); await file.sync(); await file.close(); await rename(tmp,path); }
  catch(error) { await file.close().catch(()=>{}); await unlink(tmp).catch(()=>{}); throw error; }
}
async function json(page,url) {
  const response=await page.request.get(url);
  need(response.ok(),'Original application read failed: '+response.status()+' '+new URL(url).pathname);
  const value=await response.json(); await response.dispose(); return value;
}
async function download(page, control, path) {
  const [file]=await Promise.all([page.waitForEvent('download'),control.click()]);
  await file.saveAs(path); need(!await file.failure(),'Original browser download failed.');
  const bytes=await readFile(path);
  return {path,bytes:bytes.length,sha256:sha(bytes),suggestedFilename:file.suggestedFilename()};
}

/**
 * Reuses the caller's existing browser context and completed original journey.
 * Read-only controls and same-source downloads preserve saved review/decision editions.
 * Screenshots require the producing peer's direct viewing; capture does not mark review complete.
 */
export async function renderCanadaBuysDelivery({page,url,receivingUrl,journey,bidderResponse,outputDirectory}) {
  need(journey?.status==='completed' && journey.saved?.workshare?.id,'Supply the completed original browser journey.');
  const directory=resolve(outputDirectory); await mkdir(directory,{recursive:true,mode:0o700});
  const result={schema:'commons.canadabuys.rendered-delivery.v1',status:'running',
    startedAt:new Date().toISOString(),directory,noticeId:journey.noticeId,
    workshareId:journey.saved.workshare.id,screenshots:[],views:[],downloads:[],browserErrors:[],
    producerInspection:{status:'AWAITING_PRODUCER_VIEW',instruction:'Open the exact saved screenshots, inspect the outgoing files and operate any remaining relevant controls. Repair presentation defects in the same source before presenting the delivery.'}};
  const checkpoint=()=>atomic(join(directory,'result.json'),result);
  const pages=[], initialViewport=page.viewportSize();
  const fresh=async label=>{
    const next=await page.context().newPage(); next.setDefaultTimeout(20000);
    next.on('pageerror',error=>result.browserErrors.push({page:label,message:error.message}));
    pages.push(next); return next;
  };
  let sequence=0;
  async function capture(target,name,{region,disclosure=false}={}) {
    if(region) await target.locator(region).scrollIntoViewIfNeeded();
    if(disclosure) for(const details of await target.locator('details').all())
      if(await details.isVisible()) await details.evaluate(el=>el.open=true);
    const layout=await target.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},
      document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
      overflow:document.documentElement.scrollWidth>innerWidth+1}));
    const view={name,url:target.url(),...layout,screenshots:[]};
    const stops=await target.evaluate(selector=>{
      const region=selector?document.querySelector(selector):document.body, box=region.getBoundingClientRect();
      const start=Math.max(0,scrollY+box.top-20),height=box.height,maximum=Math.max(0,document.documentElement.scrollHeight-innerHeight);
      return [...new Set([start, start+Math.max(0,(height-innerHeight)/2),start+Math.max(0,height-innerHeight)].map(y=>Math.round(Math.min(maximum,y))))];
    },region||null);
    for(let i=0;i<stops.length;i++) {
      await target.evaluate(y=>scrollTo(0,y),stops[i]);
      await target.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const filename=String(++sequence).padStart(3,'0')+'-'+name+'-'+(i+1)+'.png',path=join(directory,filename);
      await target.screenshot({path,fullPage:false});
      const bytes=await readFile(path),record={file:filename,path,bytes:bytes.length,sha256:sha(bytes),
        viewport:layout.viewport,scrollY:stops[i],view:name};
      result.screenshots.push(record);view.screenshots.push(filename);
    }
    result.views.push(view); await checkpoint();
  }
  async function ready(target,base) {
    const u=new URL(base);u.hash=new URLSearchParams({notice:journey.noticeId}).toString();
    await target.goto(u.href,{waitUntil:'domcontentloaded'});
    await target.waitForFunction(()=>/revision \d+/.test(document.getElementById('status')?.textContent||''));
    await target.locator('#search').fill(journey.noticeId);
    await target.locator('[data-notice-id='+attr(journey.noticeId)+']').click();
    await target.locator('#notice-language').selectOption('both');
  }
  async function openSavedRecord(target,expected,action) {
    const route='/api/bidder/records/'+expected.kind+'/'+encodeURIComponent(expected.id);
    const [response]=await Promise.all([target.waitForResponse(response=>{
      const u=new URL(response.url());
      return response.request().method()==='GET' && u.pathname===route && u.searchParams.get('history')==='true';
    }),action()]);
    need(response.ok(),'The saved bidder record could not be opened.');
    const value=await response.json(),actual=value.record||value;
    need(actual.id===expected.id&&actual.revision===expected.revision&&actual.editionSha256===expected.editionSha256,
      'The opened '+expected.kind+' edition changed; retain it for review in the original desk.');
    await target.waitForFunction(record=>{
      const kind=record.recordKind, label=document.getElementById(kind+'-revision')?.textContent||'';
      if(!label.startsWith('Saved revision '+record.revision+' · '))return false;
      if(kind==='evidence')return document.getElementById('e-download')?.getAttribute('href')===
        '/api/bidder/evidence/'+encodeURIComponent(record.id)+'/file?revision='+record.revision;
      if(kind==='requirement')return document.getElementById('r-text')?.value===record.requirementText;
      if(kind==='profile')return document.getElementById('profile-select')?.value===record.id&&
        document.getElementById('p-label')?.value===record.label&&document.getElementById('p-legal')?.value===(record.legalName||'');
      return document.getElementById('decision-form')?.dataset.contextSha256===record.contextSha256&&
        [...document.querySelectorAll('#decision-reports a')].some(a=>a.getAttribute('href')===
          '/api/bidder/decisions/'+encodeURIComponent(record.id)+'/report?revision='+record.revision+'&format=html');
    },{...actual,recordKind:expected.kind});
    return actual;
  }
  async function viewFile(target,record,name,mime) {
    const bytes=await readFile(record.path);
    need(bytes.length===record.bytes && sha(bytes)===record.sha256,'Outgoing file changed before rendering: '+name);
    const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    // A dedicated intercepted navigation presents the exact HTML bytes without file:// restrictions.
    // Text documents retain their exact bytes and use an explicit readable text viewer.
    const html=mime==='text/html'?body:'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(name)+'</title><style>body{font:14px/1.6 system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 20px;color:#222;background:#fff}h1{font-size:22px}pre{font:13px/1.55 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+escape(name)+'</h1><pre>'+escape(body)+'</pre></html>';
    const route='https://canadabuys-delivery.invalid/'+encodeURIComponent(name);
    await target.route(route,handler=>handler.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
    try {
      await target.goto(route,{waitUntil:'load'});
      for(const width of [1440,390]) { await target.setViewportSize({width,height:960}); await capture(target,name+'-'+width,{disclosure:true}); }
    } finally { await target.unroute(route); await target.goto('about:blank'); }
    result.downloads.push({...record,name,mime,renderedAs:mime==='text/html'?'original-html':'original-text-viewer'});
    await checkpoint();
  }
  try {
    const original=(await json(page,new URL('/api/workspace',url).href)).workspace;
    need(original.id===journey.workspace.id,'The original operator workspace identity changed.');
    result.workspaceBefore=original;
    let receivingBefore;
    if(receivingUrl) {
      const expected=journey.receiving?.after?.id||journey.receiving?.before?.id;
      need(expected,'The original journey must identify its receiving workspace.');
      receivingBefore=(await json(page,new URL('/api/workspace',receivingUrl).href)).workspace;
      need(receivingBefore.id===expected,'The original receiving workspace identity changed.');
      result.receivingWorkspaceBefore=receivingBefore;
    }
    const operator=await fresh('procurement');
    for(const width of [1440,390]) {
      await operator.setViewportSize({width,height:960});await ready(operator,url);
      for(const tab of ['notice','source','qualification','workshare']) {
        await operator.locator('#tab-'+tab).click();
        if(tab==='workshare') {
          const choose=operator.locator('[data-workshare-id='+attr(result.workshareId)+']');
          if(await choose.count())await choose.click();
          await operator.locator('#workshare-form').waitFor();
        }
        await capture(operator,'procurement-'+tab+'-'+width,{region:'#active-panel'});
      }
      await operator.locator('#search').fill('__no_retained_notice_'+randomUUID());
      await capture(operator,'procurement-empty-search-'+width,{region:'#notice-list'});
      await ready(operator,url);
    }
    await operator.close();
    const documentPage=await fresh('outgoing-files');
    for(const [key,name] of [['workshareHandover','partner-workshare'],['report_html','complete-notice-report']])
      if(journey.downloads[key])await viewFile(documentPage,journey.downloads[key],name,'text/html');
    if(bidderResponse) {
      need(bidderResponse.status==='completed' && bidderResponse.summary?.originalNoticeId===journey.noticeId,
        'Use the completed response for this original notice.');
      for(const [key,expected] of Object.entries(bidderResponse.records)) {
        const value=await json(page,new URL('/api/bidder/records/'+expected.kind+'/'+encodeURIComponent(expected.id),url).href);
        const actual=value.record||value;
        need(actual.revision===expected.revision&&actual.editionSha256===expected.editionSha256,
          'The saved response '+key+' has changed; retain the current edition for review in the original desk.');
      }
      const bidder=await fresh('bidder');
      const bidderURL=new URL('/bidder-desk',url);bidderURL.searchParams.set('noticeId',journey.noticeId);
      const decisionId=bidderResponse.summary.decisionId;
      const profileId=bidderResponse.records.profile?.id;
      need(profileId,'The original response must identify its saved company profile.');
      for(const width of [1440,390]) {
        await bidder.setViewportSize({width,height:960});await bidder.goto(bidderURL.href,{waitUntil:'domcontentloaded'});
        await bidder.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Opened '));
        need(await bidder.locator('#notice-select').inputValue()===journey.noticeId,'The bidder page selected another notice.');
        await openSavedRecord(bidder,bidderResponse.records.profile,
          ()=>bidder.locator('#profile-select').selectOption(profileId));
        for(const tab of ['notice','profile','evidence','requirement','decision']) {
          await bidder.locator('[data-tab='+attr(tab)+']').click();
          if(tab==='evidence'||tab==='requirement') {
            const selected=Object.values(bidderResponse.records).find(record=>record.kind===tab);
            need(selected,'The original response has no saved '+tab+' record.');
            await openSavedRecord(bidder,selected,()=>bidder.locator('[data-open-kind='+attr(tab)+'][data-open-id='+attr(selected.id)+']').click());
          }
          if(tab==='decision') {
            const savedDecision=Object.values(bidderResponse.records).find(record=>record.kind==='decision'&&record.id===decisionId);
            need(savedDecision,'The original response must identify its saved decision edition.');
            await openSavedRecord(bidder,savedDecision,()=>bidder.locator('[data-open-kind="decision"][data-open-id='+attr(decisionId)+']').click());
            await bidder.locator('#decision-compare').click();
            await bidder.locator('#decision-comparison .panel').waitFor();
            const current=await json(bidder,new URL('/api/bidder/decisions/'+encodeURIComponent(decisionId)+'/compare',url).href);
            result.decisionComparison=current;
            need(current.changes?.changed===false,'The original saved decision context changed before rendering.');
          }
          await capture(bidder,'bidder-'+tab+'-'+width,{region:'#pane-'+tab});
        }
      }
      // Open every retained captured evidence document via its actual saved-record download control.
      for(const [key,record] of Object.entries(bidderResponse.records)) {
        if(record.kind!=='evidence')continue;
        const originalRecord=await json(bidder,new URL('/api/bidder/records/evidence/'+encodeURIComponent(record.id)+'?revision='+record.revision,url).href);
        const evidence=originalRecord.record||originalRecord;if(evidence.accessState!=='CAPTURED')continue;
        await bidder.locator('[data-tab="evidence"]').click();
        await openSavedRecord(bidder,record,()=>bidder.locator('[data-open-kind="evidence"][data-open-id='+attr(record.id)+']').click());
        const exactHref='/api/bidder/evidence/'+encodeURIComponent(record.id)+'/file?revision='+record.revision;
        const control=bidder.locator('#e-download[href='+attr(exactHref)+']');
        await control.waitFor({state:'visible'});
        const captured=await download(bidder,control,join(directory,'evidence-'+record.id+'.txt'));
        need(captured.bytes===evidence.bytes&&captured.sha256===evidence.sha256,'Saved evidence download differs from its exact edition: '+key);
        await viewFile(documentPage,captured,'evidence-'+key,'text/plain');
      }
      const retainedReport=bidderResponse.downloads['decision.html'];
      if(retainedReport)await viewFile(documentPage,retainedReport,'saved-bid-decision','text/html');
      result.bidder={decisionId,revision:bidderResponse.summary.decisionRevision,packageId:bidderResponse.packageId};
      await bidder.close();
    }
    await documentPage.close();
    if(receivingUrl) {
      const receiver=await fresh('receiver');
      await receiver.setViewportSize({width:390,height:960});await ready(receiver,receivingUrl);
      await receiver.locator('#tab-workshare').click();
      const choose=receiver.locator('[data-workshare-id='+attr(result.workshareId)+']');if(await choose.count())await choose.click();
      await receiver.locator('#workshare-form').waitFor();await capture(receiver,'receiver-saved-workshare-390',{region:'#active-panel'});
      const receivingAfter=(await json(receiver,new URL('/api/workspace',receivingUrl).href)).workspace;
      need(receivingAfter.id===receivingBefore.id&&receivingAfter.revision===receivingBefore.revision,
        'The original receiving workspace changed during rendering.');
      result.receiver={url:receivingUrl,workshareId:result.workshareId,before:receivingBefore,after:receivingAfter};
      await receiver.close();
    }
    const after=(await json(page,new URL('/api/workspace',url).href)).workspace;result.workspaceAfter=after;
    need(after.id===original.id && after.revision===original.revision,
      'The read-only rendered course observed a workspace change; retain it for the original reviewer.');
    need(!result.browserErrors.length,'The original rendered application reported browser errors.');
    result.layoutFindings=result.views.filter(view=>view.overflow).map(view=>({name:view.name,viewport:view.viewport,document:view.document}));
    result.status='captured';result.completedAt=new Date().toISOString();await checkpoint();return result;
  } catch(error) {
    result.status='failed';result.error={message:error.message,stack:error.stack};await checkpoint();
    error.renderedDeliveryDirectory=directory;throw error;
  } finally {
    for(const target of pages)await target.close().catch(()=>{});
    if(initialViewport)await page.setViewportSize(initialViewport).catch(()=>{});
  }
}
