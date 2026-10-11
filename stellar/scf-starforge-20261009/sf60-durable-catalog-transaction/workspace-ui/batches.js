/* MIT. Original signed-batch intake and native plan/recovery rendering. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), MAX = 8 * 1024 * 1024 - 8192;
  const NATIVE = 'stellar-forge.catalog-signed-batch/v1';
  const FILES = 'stellar-forge.catalog-signed-batch-files/v1';
  let host;
  const element = (tag, value, name) => {
    const node = document.createElement(tag); if (value !== undefined) node.textContent = String(value);
    if (name) node.className = name; return node;
  };
  const json = value => JSON.stringify(value, null, 2);
  const utf8 = bytes => new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const parse = bytes => {try {return JSON.parse(utf8(bytes));} catch {throw Error('Choose valid UTF-8 JSON, without changing the original declaration bytes.');}};
  async function bytes(file, max) {
    if (!file || !file.size || file.size > max) throw Error(`A selected input is empty or exceeds ${max.toLocaleString()} bytes.`);
    return new Uint8Array(await file.arrayBuffer());
  }
  function encode(source) {
    let value = ''; for (let i=0;i<source.length;i+=8192) value += String.fromCharCode(...source.subarray(i,i+8192));
    return btoa(value);
  }
  function resolveReference(reference, selected) {
    if (typeof reference !== 'string' || !reference || /[\\\x00-\x1f]/.test(reference) || reference.startsWith('/') || /^[A-Za-z]:/.test(reference))
      throw Error('The browser needs relative manifest references. Use an original signed-batch JSON for a CLI manifest with absolute paths.');
    const path = reference.split('/').filter(part=>part!=='.').join('/');
    if (path.split('/').some(part=>!part || part==='..')) throw Error('Select a manifest with explicit relative file names inside its folder.');
    const matches = selected.filter(file => {
      const name = file.webkitRelativePath || file.name;
      return name === path || name.endsWith('/'+path);
    });
    if (matches.length !== 1) throw Error(`${matches.length ? 'Ambiguous' : 'Missing'} manifest input: ${reference}. Select its exact containing folder or referenced file set.`);
    return matches[0];
  }
  async function readBatch(file, selected) {
    const document = parse(await bytes(file, MAX));
    const candidate = document.schema === 'stellar-forge.catalog-operator-command/v1' && document.operation === 'apply-batch'
      ? document.input?.batch : document;
    if (candidate?.schema === NATIVE) {
      if (!Array.isArray(candidate.admissions) || !candidate.admissions.length || candidate.admissions.length > 1000)
        throw Error('An original signed batch contains 1 to 1,000 admissions.');
      if (new TextEncoder().encode(JSON.stringify({batch:candidate})).length > MAX) throw Error('The batch exceeds the original command size limit.');
      return candidate;
    }
    if (!plain(candidate) || candidate.schema !== FILES || Object.keys(candidate).length !== 2 ||
        !Array.isArray(candidate.admissions) || !candidate.admissions.length || candidate.admissions.length > 1000)
      throw Error('Choose the original signed-batch, retained apply-batch command, or signed-batch-files manifest.');
    const cache = new Map(), admissions = [];
    const load = async (reference,max) => {
      const file = resolveReference(reference,selected);
      if (file.size > max) throw Error(`Manifest input exceeds its original size limit: ${reference}`);
      if (!cache.has(file)) cache.set(file,await bytes(file,max));
      return cache.get(file);
    };
    let size = 0;
    for (const [index,row] of candidate.admissions.entries()) {
      const fields = ['sellerId','sequence','sourceURL','observedAt','entry','proofs'];
      if (!plain(row) || Object.keys(row).length !== fields.length || fields.some(key=>!Object.hasOwn(row,key)))
        throw Error(`Manifest row ${index+1} must contain the original six admission-file fields.`);
      const source = await load(row.entry,65536), proofBytes = await load(row.proofs,384*1024);
      parse(source);
      const admission = {sellerId:row.sellerId,sequence:row.sequence,sourceURL:row.sourceURL,
        observedAt:row.observedAt,sourceBase64:encode(source),proofs:parse(proofBytes)};
      size += new TextEncoder().encode(JSON.stringify(admission)).length + 1;
      if (size > MAX - 1024) throw Error('The selected inputs exceed the original batch command size limit.');
      admissions.push(admission);
      $('batch-intake-state').textContent = `Reading referenced files: ${index+1} of ${candidate.admissions.length}. No catalog change has been sent.`;
    }
    return {schema:NATIVE,admissions};
  }
  function lazyJSON(parent, title, value) {
    const details = element('details'), pre = element('pre');
    details.append(element('summary',title),pre);
    details.addEventListener('toggle',()=>{if(details.open && !pre.textContent)pre.textContent=typeof value==='function'?value():json(value);});
    parent.append(details);
  }
  function paginate(target, rows, describe, render) {
    const toolbar=element('div',undefined,'batch-toolbar'),label=element('label','Filter this retained batch');
    const search=element('input');search.type='search';search.placeholder='Resource, seller, sequence, or result';label.append(search);toolbar.append(label);
    const content=element('div'),pager=element('div',undefined,'pager'),state=element('span'),buttons=element('div');
    const previous=element('button','Previous','secondary'),next=element('button','Next','secondary');previous.type=next.type='button';
    buttons.append(previous,next);pager.append(state,buttons);target.append(toolbar,content,pager);
    let offset=0,selected=rows;
    const draw=()=>{
      content.replaceChildren(...selected.slice(offset,offset+20).map(render));
      if(!selected.length)content.append(element('p','No members match this filter.','empty'));
      state.textContent=`${selected.length?offset+1:0}–${Math.min(offset+20,selected.length)} of ${selected.length} members`;
      previous.disabled=offset===0;next.disabled=offset+20>=selected.length;
    };
    search.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();selected=rows.filter(row=>describe(row).toLowerCase().includes(query));offset=0;draw();});
    previous.addEventListener('click',()=>{offset=Math.max(0,offset-20);draw();});next.addEventListener('click',()=>{offset+=20;draw();});draw();
  }
  function count(target, pairs) {
    const section=element('div',undefined,'batch-counts');
    for(const [name,value] of pairs){const item=element('div');item.append(element('strong',value),element('span',name));section.append(item);}target.append(section);
  }
  function projection(title, snapshot) {
    const side=element('section');side.append(element('h4',title));
    if(!snapshot){side.append(element('p','Not in the catalog'));return side;}
    side.append(element('p',`${snapshot.state} · sequence ${snapshot.sequence}`),element('p',snapshot.resourceURL,'batch-path'));
    for(const [index,option] of (snapshot.accepts??[]).entries()){
      side.append(element('div',`Option ${index+1}: ${option.amount} atomic`,'batch-atomic'));
      const list=element('dl');host.detailList(list,[['Network',option.network],['Asset',option.asset],['Recipient',option.payTo],['Scheme',option.scheme]]);side.append(list);
    }
    return side;
  }
  function renderReview(target, record) {
    target.replaceChildren();target.hidden=false;
    const plan=record.batchReview, rows=plan.review.changes;
    target.append(element('h3','Ordered native catalog changes'),element('p','These are the original transaction preview projections. Original declaration bytes and ordered proofs remain retained with each member.','muted'));
    count(target,[['Requested',plan.review.requested],['Changes',plan.review.applied],['Exact replays',plan.review.replayed],['Resulting active resources',plan.review.activeResources]]);
    target.append(element('p',`Earliest verified proof expiry: ${plan.expiresAt}. Apply checks every proof again. ${Date.parse(plan.expiresAt)<=Date.now()?'This saved proof window has expired.':''}`,'batch-expiry'));
    paginate(target,rows,row=>`${row.catalogKey} ${record.input.batch.admissions[row.index]?.sellerId} ${row.decision} ${row.after?.sequence}`,row=>{
      const original=record.input.batch.admissions[row.index],card=element('article',undefined,'batch-member');
      card.append(element('h4',`${row.index+1}. ${original.sellerId} · ${row.decision}`),element('p',row.catalogKey,'batch-path'));
      const sides=element('div',undefined,'revision-columns');sides.append(projection('Before this member',row.before),projection('After this member',row.after));card.append(sides);
      lazyJSON(card,'Exact original declaration bytes',()=>utf8(Uint8Array.from(atob(original.sourceBase64),c=>c.charCodeAt(0))));
      lazyJSON(card,'Original ordered seller proofs',original.proofs);
      lazyJSON(card,'Original source and observation',{sourceURL:original.sourceURL,observedAt:original.observedAt,sequence:original.sequence});
      return card;
    });
  }
  function renderRecovery(target, report) {
    target.replaceChildren();target.hidden=!report;if(!report)return;
    target.append(element('h3','Native batch effect recovery'));
    count(target,[['Original members',report.counts.requested],['Exact effects observed',report.counts.observed],['Unavailable reads',report.counts.unavailable]]);
    target.append(element('p',`${report.coherentSnapshot?'One coherent native catalog head.':'The catalog changed during reading or a read was unavailable.'} ${report.interpretation}`,'muted'));
    paginate(target,report.items,row=>`${row.catalogKey} ${row.sellerId} ${row.sequence} ${row.state}`,row=>{
      const card=element('article',undefined,'batch-member');
      card.append(element('h4',`${row.index+1}. ${row.sellerId} · sequence ${row.sequence}`),element('span',row.state,'badge'),element('p',row.catalogKey,'batch-path'),element('p',row.explanation??row.error));
      lazyJSON(card,'Matching native evidence and original digest',row);return card;
    });
  }
  function decorateRecord(record) {
    const batch=record.operation==='apply-batch';
    const actions = $('execute-operation').parentElement;
    actions.classList.toggle('batch-command-bar', batch);
    if (batch) $('revision-comparison').before(actions);
    else $('operation-inspection').before(actions);
    $('export-batch-review').hidden=$('refresh-batch-review').hidden=!batch;
    $('export-batch-recovery').hidden=!batch || record.reconciliation?.schema!=='stellar-forge.catalog-effect-recovery/v1';
    const summary=$('review-input').parentElement.querySelector('summary');
    summary.textContent=batch?'Original batch bindings (export command includes every source byte)':'Exact reviewed input';
    if(!batch)return;
    host.detailList($('review-summary'),[['Operation ID',record.id],['Intent SHA-256',record.digest],['Members / sellers',`${record.summary.members} / ${record.summary.sellerCount}`],['Original batch SHA-256',record.summary.batchSha256],['Reviewed catalog head',record.input.expectedHead],['Original native plan',record.input.expectedPlan],['Policy SHA-256',record.policySha256],['Created',record.createdAt],['Updated',record.updatedAt]]);
    $('review-input').textContent=json({summary:record.summary,expectedHead:record.input.expectedHead,expectedPlan:record.input.expectedPlan,expectedBatch:record.input.expectedBatch,expectedPolicy:record.input.expectedPolicy});
  }
  function reconciliationLabel(verdict) {
    return {MATCHING_ORIGINAL_REVISION_PRESENT:'Matching revision found',NO_MATCHING_REVISION_OBSERVED:'No matching revision observed',
      ALL_ORIGINAL_BATCH_EFFECTS_PRESENT:'All exact batch effects observed',SOME_ORIGINAL_BATCH_EFFECTS_PRESENT:'Some exact batch effects observed',NO_ORIGINAL_BATCH_EFFECTS_OBSERVED:'No exact batch effects observed'}[verdict]??verdict;
  }
  async function exportDocument(kind) {
    const record=host.getRecord();if(!record)return;
    const result=await host.api(`/api/operations/${record.id}/export/${kind}`);
    const url=URL.createObjectURL(new Blob([result.content],{type:result.mediaType})),a=element('a');
    a.href=url;a.download=result.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function connect(api) {
    host=api;
    host.form('batch-form',async()=>{
      const file=$('batch-input').files[0];
      const selected=[...$('batch-files').files,...$('batch-folder').files];
      $('batch-intake-state').textContent='Reading original received files…';
      try {
        const batch=await readBatch(file,selected);
        $('batch-intake-state').textContent=`Verifying ${batch.admissions.length} original admissions through the running catalog operator…`;
        const record=await host.api('/api/batch/review',{batch});
        $('batch-intake-state').textContent=`Retained review ${record.id} · ${record.summary.members} members. Catalog unchanged by preview.`;
        host.showReview(record);
      } catch(error){$('batch-intake-state').textContent='No batch was submitted by this review. '+error.message;throw error;}
    });
    host.action($('export-command'),()=>exportDocument('command'));
    host.action($('export-batch-review'),()=>exportDocument('review'));
    host.action($('export-batch-recovery'),()=>exportDocument('recovery'));
    host.action($('refresh-batch-review'),async()=>{
      const record=host.getRecord();if(record?.operation!=='apply-batch')return;
      host.showReview(await host.api('/api/batch/review',{batch:record.input.batch}));
    });
  }
  window.CatalogBatchUI=Object.freeze({connect,renderReview,renderRecovery,decorateRecord,reconciliationLabel,readBatch});
})();
