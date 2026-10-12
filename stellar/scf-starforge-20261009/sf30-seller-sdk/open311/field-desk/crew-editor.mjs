// MIT. Portable field crew editor; complete self-contained return workflow.
export function renderCrewEditor(packet) {
  if (!packet || packet.schema !== 'commons.open311.field-crew-package.v1' || !Array.isArray(packet.visits) || !packet.id || !packet.sha256) {
    throw new TypeError('A complete saved field crew package is required.');
  }
  function crewApp() {
    'use strict';
    const packet = JSON.parse(document.getElementById('crew-packet').textContent);
    const $ = (s, root = document) => root.querySelector(s);
    const $$ = (s, root = document) => [...root.querySelectorAll(s)];
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const arr = v => Array.isArray(v) ? v : [];
    const copy = v => JSON.parse(JSON.stringify(v));
    const pretty = v => JSON.stringify(v, null, 2);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const fieldKeys = ['status','actualStart','actualEnd','completionNote','notes','resources','attachmentIds'];
    const statuses = ['planned','assigned','in_progress','completed','unable','cancelled'];
    const label = v => String(v ?? '').replace(/_/g, ' ');
    const makeId = prefix => prefix + '-' + crypto.randomUUID();
    const asLocal = value => { if (!value) return ''; const d = new Date(value); if (!Number.isFinite(d.getTime())) return ''; const pad = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const asISO = value => { if (!value) return null; const d = new Date(value); if (!Number.isFinite(d.getTime())) throw new Error('Enter a complete date and time.'); return d.toISOString(); };
    const displayTime = value => value ? new Date(value).toLocaleString() : '—';
    const key = 'open311-field-return:' + packet.id + ':' + packet.sha256;
    let draft = {name: packet.name + ' — crew return', returnedBy:'', note:'', visits:{}, attachments:[], updatedAt:null};
    let current = packet.visits[0]?.visit?.id ?? '';
    let dbPromise, saveQueue = Promise.resolve(), saving = false, edited = 0;
    let objectUrls = [];
    const originals = new Map(packet.visits.map(item => [item.visit.id, item]));
    const baseline = id => copy(originals.get(id)?.visit?.field ?? {});
    const fields = id => draft.visits[id] ?? baseline(id);
    const normalized = f => ({status:f.status ?? 'planned',actualStart:f.actualStart ?? null,actualEnd:f.actualEnd ?? null,completionNote:f.completionNote ?? '',notes:arr(f.notes),resources:arr(f.resources),attachmentIds:arr(f.attachmentIds)});
    const changedFields = id => {
      const b=normalized(baseline(id)), f=normalized(fields(id)), result={};
      for (const k of fieldKeys) if (!same(b[k],f[k])) result[k]=f[k];
      return result;
    };
    const changedIds = () => packet.visits.map(x=>x.visit.id).filter(id=>Object.keys(changedFields(id)).length);
    function notice(message, error=false) { const n=$('#notice');n.textContent=message;n.className=error?'notice error':'notice';n.hidden=false; }
    function database() {
      return dbPromise ??= new Promise((resolve,reject)=>{
        if (!globalThis.indexedDB) return reject(new Error('Browser storage is unavailable'));
        const r=indexedDB.open('open311-field-crew-editor',1);
        r.onupgradeneeded=()=>r.result.createObjectStore('drafts');
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      });
    }
    async function readDraft() {
      try { const db=await database(); return await new Promise((resolve,reject)=>{const r=db.transaction('drafts','readonly').objectStore('drafts').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); }
      catch { try {return JSON.parse(localStorage.getItem(key)||'null');} catch {return null;} }
    }
    function persist() {
      draft.updatedAt=new Date().toISOString();
      const snapshot=copy(draft), version=++edited;
      $('#saved-state').textContent='Saving in this browser…';
      saveQueue=saveQueue.catch(()=>{}).then(async()=>{
        try {
          const db=await database();
          await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(snapshot,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
        } catch (cause) {
          try {localStorage.setItem(key,JSON.stringify(snapshot));}
          catch {if(version===edited)$('#saved-state').textContent='Kept in this tab. Download the return to save these edits and files.';return;}
        }
        if(version===edited)$('#saved-state').textContent='Saved in this browser at '+displayTime(snapshot.updatedAt)+'. Download a return to share the work.';
      });
      updateCount();
      return saveQueue;
    }
    const options = (values, chosen) => values.map(v=>`<option value="${esc(v)}"${v===chosen?' selected':''}>${esc(label(v))}</option>`).join('');
    function updateCount() {
      $('#change-count').textContent=changedIds().length+' of '+packet.visits.length+' visits changed';
      for (const b of $$('[data-visit]')) {
        const changed=Object.keys(changedFields(b.dataset.visit)).length>0;
        b.querySelector('.changed').textContent=changed?'Changed':'Unchanged';
        b.setAttribute('aria-current',b.dataset.visit===current?'true':'false');
      }
    }
    function sourceDescription(row) {
      const r=row?.request??{};
      return r.description??r.serviceName??r.service_name??r.summary??r.title??'Original service request';
    }
    function attachmentRow(id) {
      const a=draft.attachments.find(x=>x.id===id)??arr(packet.attachments).find(x=>x.id===id);
      return `<li><span>${esc(a?.filename??id)}${a?.bytes!=null?` <small>${Number(a.bytes).toLocaleString()} bytes</small>`:''}</span><span class="actions">${a?.contentBase64?`<button type="button" data-download-file="${esc(id)}">Open file</button>`:''}<button type="button" data-remove-file="${esc(id)}">Remove from visit</button></span></li>`;
    }
    function renderVisit() {
      for (const url of objectUrls) URL.revokeObjectURL(url);objectUrls=[];
      const item=originals.get(current);
      if(!item){$('#visit-content').innerHTML='<p>No visits in this package.</p>';return;}
      const v=item.visit, f=normalized(fields(current)), r=item.sourceRow?.request??{};
      const resources=f.resources.map((x,i)=>`<tr data-resource-row="${esc(x.id)}"><td><select name="resource-kind" aria-label="Resource type">${options(['labor','material','equipment','other'],x.kind)}</select></td><td><input name="resource-name" aria-label="Resource name" value="${esc(x.name)}" required><input name="resource-note" aria-label="Resource note" placeholder="Optional note" value="${esc(x.note)}"></td><td><input name="resource-quantity" inputmode="decimal" aria-label="Quantity" value="${esc(x.quantity)}" required></td><td><input name="resource-unit" aria-label="Unit" value="${esc(x.unit)}" required></td><td><input name="resource-cost" inputmode="decimal" aria-label="Unit cost" value="${esc(x.unitCost)}" placeholder="Optional"></td><td><input name="resource-currency" aria-label="Currency" value="${esc(x.currency)}" placeholder="USD"></td><td><button type="button" data-remove-resource="${esc(x.id)}" aria-label="Remove resource ${i+1}">Remove</button></td></tr>`).join('');
      $('#visit-content').innerHTML=`
        <div class="section-heading"><div><p class="eyebrow">Visit · ${esc(v.serviceRequestId??item.sourceRow?.serviceRequestId??'')}</p><h2>${esc(v.title||sourceDescription(item.sourceRow))}</h2></div><span class="badge">${esc(label(f.status))}</span></div>
        <div class="facts"><div><small>Crew</small><strong>${esc(item.crew?.name??'Unassigned')}</strong></div><div><small>Planned visit</small><strong>${esc(displayTime(v.plannedStart))}</strong></div><div><small>Due</small><strong>${esc(displayTime(v.dueAt))}</strong></div><div><small>Priority</small><strong>${esc(label(v.priority))}</strong></div></div>
        <div class="instructions"><h3>Work instructions</h3><p>${esc(v.instructions||'No additional visit instructions.')}</p><p>${esc(sourceDescription(item.sourceRow))}</p></div>
        <form id="visit-form">
          <div class="form-grid"><label>Field outcome<select name="status">${options(statuses,f.status)}</select></label><label>Actual start<input type="datetime-local" name="actualStart" value="${esc(asLocal(f.actualStart))}"></label><label>Actual end<input type="datetime-local" name="actualEnd" value="${esc(asLocal(f.actualEnd))}"></label></div>
          <p class="hint">Date and time entry uses this device's time zone: <strong>${esc(Intl.DateTimeFormat().resolvedOptions().timeZone||'local device time')}</strong>. The returned file records the exact UTC instants.</p>
          <label>Completion or exception note<textarea name="completionNote" rows="4">${esc(f.completionNote)}</textarea></label>
          <section><div class="section-heading"><h3>Field notes</h3><button type="button" id="add-note">Add note</button></div><div id="notes">${f.notes.map(n=>`<div class="note-row" data-note-row="${esc(n.id)}"><div class="form-grid"><label>Author<input name="note-author" value="${esc(n.author)}" required></label><label>Recorded<input name="note-recordedAt" type="datetime-local" value="${esc(asLocal(n.recordedAt))}" required></label><button type="button" data-remove-note="${esc(n.id)}">Remove note</button></div><label>Note<textarea name="note-text" rows="2" required>${esc(n.text)}</textarea></label></div>`).join('')||'<p class="muted">No field notes.</p>'}</div></section>
          <section><div class="section-heading"><h3>Labor, materials and equipment</h3><button type="button" id="add-resource">Add resource</button></div><div class="table-scroll"><table><thead><tr><th>Type</th><th>Resource and note</th><th>Quantity</th><th>Unit</th><th>Unit cost</th><th>Currency</th><th></th></tr></thead><tbody>${resources||'<tr><td colspan="7" class="muted">No resources recorded.</td></tr>'}</tbody></table></div><p class="hint">Keep each resource's unit explicit. Use a decimal quantity, such as 1.5 hours or 4 each. Unit cost is optional and requires a currency.</p></section>
          <section><div class="section-heading"><h3>Visit files</h3><label class="file-button">Add files<input id="add-files" type="file" multiple></label></div><ul class="file-list">${f.attachmentIds.map(attachmentRow).join('')||'<li class="muted">No visit files.</li>'}</ul><p class="hint">Files travel inside the returned JSON. Original report references remain in the source record below.</p></section>
        </form>
        <details><summary>Original request, approved work and assigned crew</summary><pre>${esc(pretty({source:item.source,request:item.sourceRow?.request,orders:item.sourceRow?.orders,approvedWork:item.sourceRow?.work,geometry:item.sourceRow?.geometry,crew:item.crew,visitVersion:v.versionId}))}</pre></details>`;
      updateCount();
    }
    function collectVisit() {
      const form=$('#visit-form');if(!form)return;
      const before=normalized(fields(current)), value=n=>form.elements.namedItem(n)?.value??'';
      const localISO=(name,old)=>value(name)===asLocal(old)?old:asISO(value(name));
      const notes=$$('[data-note-row]',form).map(row=>{
        const previous=before.notes.find(x=>x.id===row.dataset.noteRow), at=$('[name="note-recordedAt"]',row).value;
        return {id:row.dataset.noteRow,author:$('[name="note-author"]',row).value,text:$('[name="note-text"]',row).value,recordedAt:at===asLocal(previous?.recordedAt)?previous.recordedAt:asISO(at)};
      });
      const resources=$$('[data-resource-row]',form).map(row=>{const val=n=>$(`[name="${n}"]`,row).value;return {id:row.dataset.resourceRow,kind:val('resource-kind'),name:val('resource-name'),quantity:val('resource-quantity').trim(),unit:val('resource-unit'),unitCost:val('resource-cost').trim()||null,currency:val('resource-currency').trim()||null,note:val('resource-note')};});
      draft.visits[current]={...before,status:value('status'),actualStart:localISO('actualStart',before.actualStart),actualEnd:localISO('actualEnd',before.actualEnd),completionNote:value('completionNote'),notes,resources};
    }
    function download(text,name,type='application/json') {
      const blob=text instanceof Blob?text:new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'-');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    function decode64(text) { const raw=atob(text), bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes; }
    function encode64(bytes) { let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(raw); }
    async function addFiles(files) {
      collectVisit();const forVisit=current, additions=[];
      for(const file of files){
        const bytes=new Uint8Array(await file.arrayBuffer());
        if(!crypto.subtle)throw new Error('This browser cannot identify file contents. Open this HTML in a current browser with Web Crypto support.');
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
        const id='attachment-'+digest;
        if(!arr(packet.attachments).some(a=>a.id===id)&&!draft.attachments.some(a=>a.id===id))draft.attachments.push({id,filename:file.name,contentType:file.type||'application/octet-stream',bytes:bytes.length,sha256:digest,contentBase64:encode64(bytes)});
        additions.push(id);
      }
      const f=normalized(fields(forVisit));f.attachmentIds=[...new Set([...f.attachmentIds,...additions])];draft.visits[forVisit]=f;await persist();if(current===forVisit)renderVisit();
      notice(additions.length+' file(s) added to this visit.');
    }
    function validateReturn(ids) {
      if(!draft.returnedBy.trim())throw new Error('Enter the person or crew returning this work.');
      if(!draft.name.trim())throw new Error('Name this returned work package.');
      for(const id of ids){
        const f=normalized(fields(id)),name=originals.get(id).visit.title||id;
        if(!statuses.includes(f.status))throw new Error(name+': choose a field outcome.');
        if(f.actualStart&&f.actualEnd&&new Date(f.actualEnd)<new Date(f.actualStart))throw new Error(name+': actual end precedes actual start.');
        for(const n of f.notes)if(!n.id||!n.author.trim()||!n.text.trim()||!n.recordedAt)throw new Error(name+': complete the author, time and text of each field note.');
        for(const r of f.resources){
          if(!r.id||!r.name.trim()||!r.unit.trim()||!/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,9})?$/.test(r.quantity))throw new Error(name+': resources need a name, explicit unit and nonnegative decimal quantity (at most 18 whole and 9 fractional digits).');
          if(r.unitCost!==null&&!/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,9})?$/.test(r.unitCost))throw new Error(name+': unit cost must be a nonnegative decimal (at most 18 whole and 9 fractional digits).');
          if(r.unitCost!==null&&!r.currency)throw new Error(name+': enter a currency for each unit cost.');
          if(r.currency&&!/^[A-Za-z]{3}$/.test(r.currency))throw new Error(name+': use a three-letter currency code, such as USD.');
        }
        const known=new Set([...arr(packet.attachments),...draft.attachments].map(a=>a.id));
        for(const aid of f.attachmentIds)if(!known.has(aid))throw new Error(name+': a referenced visit file is missing from this package.');
      }
    }
    async function exportReturn() {
      collectVisit();draft.name=$('#return-name').value;draft.returnedBy=$('#returned-by').value;draft.note=$('#return-note').value;
      const ids=changedIds();if(!ids.length)throw new Error('Record at least one visit change before downloading a return.');
      validateReturn(ids);await persist();
      const used=new Set(ids.flatMap(id=>arr(changedFields(id).attachmentIds)));
      const output={schema:'commons.open311.field-return.v1',packageId:packet.id,packageSha256:packet.sha256,name:draft.name.trim(),returnedBy:draft.returnedBy.trim(),note:draft.note,visits:ids.map(id=>({visitId:id,baseVersionId:originals.get(id).visit.versionId,fields:changedFields(id)})),attachments:draft.attachments.filter(a=>used.has(a.id)).map(({filename,contentType,contentBase64})=>({filename,contentType,contentBase64}))};
      download(pretty(output)+'\n',(draft.name.trim()||'field-return')+'.json');
      notice(ids.length+' changed visit(s) included. Send this JSON back to the field desk for supervisor review.');
    }
    async function restore() {
      const saved=await readDraft();if(saved&&saved.visits&&Array.isArray(saved.attachments)){draft=saved;notice('Recovered this package’s saved edits and files.');}
      $('#package-name').textContent=packet.name;$('#package-detail').textContent=packet.visits.length+' visits · prepared '+displayTime(packet.createdAt);
      $('#package-note').textContent=packet.note||'';
      $('#return-name').value=draft.name;$('#returned-by').value=draft.returnedBy;$('#return-note').value=draft.note;
      $('#visit-list').innerHTML=packet.visits.map(({visit,crew})=>`<button type="button" data-visit="${esc(visit.id)}"><strong>${esc(visit.title||visit.serviceRequestId||visit.id)}</strong><span>${esc(crew?.name??'Unassigned')} · ${esc(displayTime(visit.plannedStart))}</span><small class="changed"></small></button>`).join('');
      $('#identity').textContent='Package '+packet.id+' · '+packet.sha256;
      renderVisit();$('#main').setAttribute('aria-busy','false');
      if(draft.updatedAt)$('#saved-state').textContent='Recovered edits last saved '+displayTime(draft.updatedAt)+'.';
    }
    document.addEventListener('input',event=>{
      if(event.target.closest('#visit-form')){try{collectVisit();persist();}catch{}}
      else if(['return-name','returned-by','return-note'].includes(event.target.id)){draft.name=$('#return-name').value;draft.returnedBy=$('#returned-by').value;draft.note=$('#return-note').value;persist();}
    });
    document.addEventListener('change',event=>{if(event.target.id==='add-files')addFiles([...event.target.files]).catch(e=>notice(e.message,true));else if(event.target.closest('#visit-form')){try{collectVisit();persist();}catch(e){notice(e.message,true);}}});
    document.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      try {
        if(button.dataset.visit){collectVisit();current=button.dataset.visit;renderVisit();return;}
        if(button.id==='download-return'){exportReturn().catch(e=>notice(e.message,true));return;}
        if(button.id==='download-original'){download(pretty(packet)+'\n',packet.name+' — original crew package.json');return;}
        if(button.dataset.downloadFile){const a=draft.attachments.find(x=>x.id===button.dataset.downloadFile)??arr(packet.attachments).find(x=>x.id===button.dataset.downloadFile);if(a?.contentBase64)download(new Blob([decode64(a.contentBase64)],{type:a.contentType}),a.filename);return;}
        collectVisit();const f=normalized(fields(current));
        if(button.id==='add-note')f.notes.push({id:makeId('note'),author:draft.returnedBy||'',text:'',recordedAt:new Date().toISOString()});
        else if(button.id==='add-resource')f.resources.push({id:makeId('resource'),kind:'labor',name:'',quantity:'1',unit:'hours',unitCost:null,currency:null,note:''});
        else if(button.dataset.removeNote)f.notes=f.notes.filter(n=>n.id!==button.dataset.removeNote);
        else if(button.dataset.removeResource)f.resources=f.resources.filter(r=>r.id!==button.dataset.removeResource);
        else if(button.dataset.removeFile)f.attachmentIds=f.attachmentIds.filter(id=>id!==button.dataset.removeFile);
        else return;
        draft.visits[current]=f;persist();renderVisit();
      } catch(e) {notice(e.message,true);}
    });
    document.addEventListener('submit',event=>event.preventDefault());
    window.addEventListener('beforeunload',()=>{try{collectVisit();localStorage.setItem(key,JSON.stringify(draft));}catch{}});
    restore().catch(e=>notice(e.message,true));
  }
  const css = `:root{font:14px/1.5 Arial,Helvetica,sans-serif;color:#252525;background:#f4f4f2}*{box-sizing:border-box}body{margin:0}a{color:inherit}button,input,select,textarea{font:inherit}button{background:#fff;border:1px solid #a7a7a1;border-radius:3px;color:#222;padding:7px 10px;min-height:34px;cursor:pointer}button:hover{background:#eee}button.primary{background:#292928;color:#fff;border-color:#292928}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #222;outline-offset:3px}header{padding:20px 26px;background:#fff;border-bottom:1px solid #ccc;display:flex;justify-content:space-between;gap:20px;align-items:center}h1{font-size:24px;margin:3px 0}h2{font-size:21px;margin:0 0 12px}h3{font-size:15px;margin:0 0 9px}p{margin:0 0 12px}small,.muted,.hint{color:#65655f}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px}.layout{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1480px;margin:0 auto}aside{padding:20px;border-right:1px solid #ccc}main{padding:24px;min-width:0}section,.instructions,details{margin:22px 0}.section-heading{display:flex;justify-content:space-between;gap:18px;align-items:start;margin-bottom:14px}.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #ccc;background:#fff}.facts>div{padding:12px;border-right:1px solid #ddd}.facts small,.facts strong{display:block}.badge{border:1px solid #aaa;padding:3px 9px;border-radius:2px;white-space:nowrap}.instructions{padding:16px;background:#eaeae6;white-space:pre-wrap}label{display:flex;flex-direction:column;gap:5px;margin:10px 0;font-weight:600}input,select,textarea{width:100%;min-width:0;background:#fff;border:1px solid #aaa;border-radius:2px;padding:8px;color:#222;font-weight:400}textarea{resize:vertical}.form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:end}.form-grid button{margin-bottom:10px}.note-row{border-top:1px solid #ccc;padding:12px 0}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}th{background:#eaeae6;font-weight:600}td input{min-width:80px}td:nth-child(2) input{min-width:170px}td input+input{margin-top:6px}td select{min-width:100px}.hint{font-size:12px;margin-top:8px}.file-button{font-weight:400;font-size:13px;margin:0}.file-list{list-style:none;padding:0}.file-list li{padding:10px;border-bottom:1px solid #ccc;display:flex;justify-content:space-between;gap:12px;align-items:center}.actions{display:flex;gap:8px;flex-wrap:wrap}#visit-list{display:flex;flex-direction:column;gap:9px}#visit-list button{text-align:left;padding:12px;background:#fff}#visit-list button[aria-current=true]{border:2px solid #333;padding:11px}#visit-list strong,#visit-list span,#visit-list small{display:block}#visit-list span{font-size:12px;margin:4px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;border:1px solid #ccc;padding:12px;max-height:380px;overflow:auto;font-size:12px}summary{cursor:pointer;font-weight:600}.notice{padding:14px 26px;background:#e9e9e4;border-bottom:1px solid #aaa}.notice.error{border:2px solid #333;font-weight:600}#return-panel{background:#fff;border:1px solid #bbb;padding:18px;margin:24px 0}#saved-state,#identity{font-size:12px;color:#666;overflow-wrap:anywhere}footer{border-top:1px solid #ccc;padding:18px 24px}#package-note{white-space:pre-wrap}.skip{position:absolute;left:-9999px}.skip:focus{position:fixed;left:10px;top:10px;padding:10px;background:#fff;z-index:2}@media(max-width:900px){.layout{grid-template-columns:220px minmax(0,1fr)}.form-grid,.facts{grid-template-columns:1fr 1fr}}@media(max-width:680px){header{display:block;padding:16px}.layout{display:block}aside{border-right:0;border-bottom:1px solid #ccc}#visit-list{display:grid;grid-template-columns:1fr 1fr}main{padding:16px}.form-grid{grid-template-columns:1fr}.file-list li{display:block}.actions{margin-top:8px}}@media print{button,input[type=file],aside,.skip,#return-panel{display:none}.layout{display:block}main{padding:0}details{break-inside:avoid}}`;
  const safeJson = JSON.stringify(packet).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Field crew work package</title><style>${css}</style></head>
<body><a class="skip" href="#main">Skip to visit</a><header><div><p class="eyebrow">Municipal operations · field crew</p><h1 id="package-name">Opening work package</h1><p id="package-detail"></p></div><div class="actions"><button type="button" id="download-original">Save original package</button><button type="button" id="download-return" class="primary">Download crew return</button></div></header>
<div id="notice" class="notice" role="status" aria-live="polite" hidden></div><div class="layout"><aside aria-label="Assigned visits"><h2>Assigned visits</h2><p id="change-count" class="muted"></p><div id="visit-list"></div></aside><main id="main" tabindex="-1" aria-busy="true"><p id="package-note"></p><div id="visit-content"></div><section id="return-panel"><h2>Return this work</h2><div class="form-grid"><label>Return name<input id="return-name" required></label><label>Returned by<input id="returned-by" autocomplete="name" required></label></div><label>Note to the supervisor<textarea id="return-note" rows="3"></textarea></label><p class="hint">A return includes changed visits and fields. The supervisor reviews your changes against the current workspace, including work returned by other people.</p><p id="saved-state">Edits are saved in this browser when browser storage is available.</p></section></main></div><footer><p id="identity"></p><p class="hint">Keep the original HTML to continue working offline. Download and send the crew return JSON to share edits and files.</p></footer>
<script id="crew-packet" type="application/json">${safeJson}</script><script>(${crewApp.toString()})();</script></body></html>\n`;
}
