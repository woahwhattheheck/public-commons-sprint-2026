// MIT. Buyer review of the actual installed supplier-order application.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

export const SUPPLIER_ORDER_BUYER_REVIEW_SCHEMA='stellar-forge.supplier-order-buyer-browser.v1';
const KINDS={ORDER:'Order',ORDERRESPONSE:'Confirmation',DISPATCHNOTIFICATION:'Dispatch',INVOICE:'Invoice'};
const GUIDES=['operator','installation','profiles','transport','merchant'];
const VIEWPORTS=[{name:'desktop',width:1440,height:1080},{name:'phone',width:390,height:844}];
const sha=body=>createHash('sha256').update(body).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const API='/api/supplier-orders';

async function servedAssets(page,origin){
  const manifest=JSON.parse(await readFile(new URL('../browser-assets.json',import.meta.url),'utf8')),files=[],seen=new Set();
  for(const [route,[path]] of manifest.routes){
    if(seen.has(path))continue;seen.add(path);
    const source=await readFile(new URL('../'+path,import.meta.url)),response=await page.request.get(origin+route);
    assert.equal(response.status(),200,'Installed asset route: '+route);const body=await response.body();
    assert.equal(body.length,source.length,'Installed asset byte count: '+route);assert.equal(sha(body),sha(source),'Installed asset source: '+route);
    files.push({route,path,bytes:body.length,sha256:sha(body)});
  }
  return files;
}

/**
 * Borrow a Playwright Page for a real running workspace. The caller owns the
 * native journey, browser and workspace lifetimes. expected.empty selects the
 * initial empty-workspace review. Otherwise provide its actual orderId and,
 * when selecting among revisions, documentIds, draftIds and transmissionIds.
 * All three maps contain immutable native record IDs, keyed by document kind.
 * The default requires all four document kinds and three saved response drafts.
 * retain(path, Buffer) saves complete bytes and returns {path,bytes,sha256}.
 * This function only reads the workspace and edits unsaved browser fields.
 */
export async function captureSupplierOrderBuyerViews({page,baseUrl,directory,role,expected={},retain}){
  assert.ok(page&&typeof retain==='function');
  assert.ok(isAbsolute(directory)&&/^[a-z][a-z0-9-]{0,63}$/.test(role));
  const opened=new URL(baseUrl),origin=opened.origin,token=new URLSearchParams(opened.hash.slice(1)).get('token');
  assert.ok(token,'Use the URL returned by this running workspace.');
  if(!expected.empty)assert.ok(typeof expected.orderId==='string'&&expected.orderId);
  const root=join(directory,'buyer-review',role,randomUUID()),screens=[],artifacts=[],checks=[],faults=[],writes=[];
  const fault=error=>faults.push(error.message);
  const request=req=>{const url=new URL(req.url());if(url.origin===origin&&url.pathname.startsWith(API)&&!['GET','HEAD'].includes(req.method()))writes.push({method:req.method(),path:url.pathname});};
  page.on('pageerror',fault);page.on('request',request);let guidePage=null;
  async function keep(path,body){const result=await retain(path,body);assert.equal(result.bytes,body.length);assert.equal(result.sha256,sha(body));artifacts.push(result);return result;}
  async function api(path){
    const response=await page.request.get(origin+API+path,{headers:{authorization:'Bearer '+token}});
    assert.equal(response.status(),200,'Read actual workspace '+path);return response.json();
  }
  async function all(path){
    const rows=[];let offset=0;
    for(;;){
      const value=await api(path+(path.includes('?')?'&':'?')+'offset='+offset+'&limit=100');assert.ok(Array.isArray(value.items),'Paged collection '+path);rows.push(...value.items);
      if(value.nextOffset!==undefined&&value.nextOffset!==null){assert.ok(value.nextOffset>offset);offset=value.nextOffset;continue;}
      if(Number.isSafeInteger(value.total)&&rows.length<value.total){assert.ok(value.items.length);offset+=value.items.length;continue;}
      return rows;
    }
  }
  async function ready(target){await target.evaluate(async()=>{await document.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));});}
  async function readAfter(action,path){
    const [response]=await Promise.all([page.waitForResponse(value=>{const url=new URL(value.url());return url.origin===origin&&url.pathname===API+path&&value.request().method()==='GET';}),action()]);
    assert.equal(response.status(),200,'Browser read '+path);await response.finished();await ready(page);
  }
  async function changedPage(prefix,action){const old=await page.locator('#'+prefix+'-page').textContent();await action();await page.waitForFunction(({prefix,old})=>document.querySelector('#'+prefix+'-page')?.textContent!==old,{prefix,old});}
  async function picture(target,viewport,name,selector,{entire=false}={}){
    const focus=target.locator(selector).first();await focus.waitFor({state:'visible'});await focus.scrollIntoViewIfNeeded();await ready(target);
    const modal=await target.locator('dialog[open]').count()?target.locator('dialog[open]').last():null;
    const geometry=await focus.evaluate(el=>{const r=el.getBoundingClientRect();return{top:r.top+scrollY,bottom:r.bottom+scrollY};});
    const extent=modal?await modal.evaluate(el=>({height:el.clientHeight,maximum:Math.max(0,el.scrollHeight-el.clientHeight)}))
      :await target.evaluate(()=>({height:innerHeight,maximum:Math.max(0,document.documentElement.scrollHeight-innerHeight)}));
    const beginning=modal?0:Math.min(extent.maximum,Math.max(0,geometry.top-20)),ending=modal?extent.maximum:Math.min(extent.maximum,Math.max(beginning,geometry.bottom-extent.height+20)),offsets=[beginning];
    if(entire)for(let y=beginning;y<ending;){y=Math.min(ending,y+Math.max(120,extent.height-100));offsets.push(y);}
    for(let index=0;index<offsets.length;index++){
      if(modal)await modal.evaluate((el,y)=>el.scrollTo({top:y,behavior:'instant'}),offsets[index]);else await target.evaluate(y=>scrollTo({top:y,behavior:'instant'}),offsets[index]);
      await ready(target);
      const layout=await target.evaluate(()=>{const doc=document.documentElement,dialog=[...document.querySelectorAll('dialog[open]')].at(-1);return{viewportWidth:innerWidth,documentWidth:doc.scrollWidth,documentClientWidth:doc.clientWidth,dialog:dialog?{clientWidth:dialog.clientWidth,scrollWidth:dialog.scrollWidth}:null};});
      assert.ok(layout.documentWidth<=layout.documentClientWidth+1,'Horizontal page overflow in '+name+' at '+viewport.name);
      if(layout.dialog)assert.ok(layout.dialog.scrollWidth<=layout.dialog.clientWidth+1,'Horizontal dialog overflow in '+name+' at '+viewport.name);
      const file=await keep(join(root,viewport.name,name+(offsets.length>1?'-'+String(index+1).padStart(2,'0'):'')+'.png'),await target.screenshot({animations:'disabled'}));
      screens.push({viewport:{width:viewport.width,height:viewport.height},name,part:index+1,parts:offsets.length,selector,scrollOffset:offsets[index],layout,file});
    }
  }
  async function closeDialog(id){await page.locator('#'+id+' [data-close="'+id+'"]').click();await page.locator('#'+id).waitFor({state:'hidden'});}
  async function inspectDocument(doc){
    await readAfter(()=>page.locator('#document-kind').selectOption(doc.kind),'/documents');
    for(;;){
      const rows=page.locator('#document-table tbody tr'),values=await rows.evaluateAll(nodes=>nodes.map(n=>[...n.children].map(c=>c.textContent.trim())));
      const index=values.findIndex(cells=>cells[0]===doc.documentId&&cells[2]===String(doc.revision));
      if(index>=0){await readAfter(()=>rows.nth(index).getByRole('button',{name:'Inspect',exact:true}).click(),'/documents/'+encodeURIComponent(doc.id));return;}
      assert.equal(await page.locator('#documents-next').isDisabled(),false,'Document revision visible: '+doc.documentId);
      await changedPage('documents',()=>page.locator('#documents-next').click());
    }
  }
  async function openDraft(draft){
    while(!await page.locator('#drafts-previous').isDisabled())await changedPage('drafts',()=>page.locator('#drafts-previous').click());
    for(;;){
      const cards=page.locator('#draft-list .draft-card'),count=await cards.count();
      for(let index=0;index<count;index++){
        await cards.nth(index).getByRole('button',{name:'Open draft',exact:true}).click();await page.locator('#draft-editor').waitFor({state:'visible'});await ready(page);
        if((await page.locator('#draft-source-selection').textContent()).includes(draft.id))return;
        await page.locator('#close-draft').click();await page.locator('#draft-editor').waitFor({state:'hidden'});
      }
      assert.equal(await page.locator('#drafts-next').isDisabled(),false,'Saved draft visible: '+draft.kind);await changedPage('drafts',()=>page.locator('#drafts-next').click());
    }
  }
  async function openDelivery(delivery,orderId){
    await page.locator('#transport-direction').selectOption(delivery.direction);await page.locator('#transport-order-id').fill(orderId??'');
    await readAfter(()=>page.locator('#transport-filter-form button[type="submit"]').click(),'/transport/transmissions');
    for(;;){
      const rows=page.locator('#transport-table tbody tr'),count=await rows.count();
      for(let index=0;index<count;index++){
        const button=rows.nth(index).getByRole('button',{name:'Open',exact:true});if(!await button.count())continue;
        await button.click();await page.locator('#transport-detail').waitFor({state:'visible'});await ready(page);
        const record=JSON.parse(await page.locator('#transport-record-json').textContent());
        if(record.id===delivery.id)return record;
        await page.locator('#transport-close-detail').click();await page.locator('#transport-detail').waitFor({state:'hidden'});
      }
      assert.equal(await page.locator('#transport-next').isDisabled(),false,'Delivery visible: '+delivery.kind);await changedPage('transport',()=>page.locator('#transport-next').click());
    }
  }
  try{
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(baseUrl,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#workspace-label')?.textContent!=='Opening workspace');
    const assets=await servedAssets(page,origin),assetSha256=sha(json(assets)),before=await api('/state'),profile=await api('/profile');
    if(expected.profileSha256)assert.equal(profile.profileSha256,expected.profileSha256);
    if(expected.profileCanSelect!==undefined)assert.equal(profile.canSelect,expected.profileCanSelect);
    const order=expected.empty?null:await api('/orders/'+encodeURIComponent(expected.orderId));
    if(expected.empty)assert.equal(before.counts.orders,0);else{assert.equal(order.orderId,expected.orderId);assert.ok(order.items.length);}
    const documents=order?await all('/documents?orderId='+encodeURIComponent(order.orderId)):[],drafts=order?await all('/drafts?orderId='+encodeURIComponent(order.orderId)):[],transmissions=await all('/transport/transmissions'+(order?'?orderId='+encodeURIComponent(order.orderId):''));
    const wantedDocuments=(expected.documentKinds??Object.keys(KINDS)).map(kind=>{if(!order)return null;const row=documents.find(d=>d.kind===kind&&(!expected.documentIds?.[kind]||d.id===expected.documentIds[kind]));assert.ok(row,'Actual document kind '+kind);return row;}).filter(Boolean);
    const wantedDrafts=(expected.draftKinds??['ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE']).map(kind=>{if(!order)return null;const row=drafts.find(d=>d.kind===kind&&(!expected.draftIds?.[kind]||d.id===expected.draftIds[kind]));assert.ok(row,'Actual saved draft kind '+kind);return row;}).filter(Boolean);
    const wantedTransmissions=(expected.deliveryKinds??[]).map(kind=>{const row=transmissions.find(d=>d.kind===kind&&(!expected.transmissionIds?.[kind]||d.id===expected.transmissionIds[kind]));assert.ok(row,'Actual delivery history '+kind);return row;});
    for(const viewport of VIEWPORTS){
      await page.setViewportSize({width:viewport.width,height:viewport.height});await page.goto(baseUrl,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>document.querySelector('#workspace-label')?.textContent!=='Opening workspace');
      await picture(page,viewport,'workspace','body');
      if(order){
        await page.locator('#order-query').fill(order.orderId);await readAfter(()=>page.locator('#order-search button[type="submit"]').click(),'/orders');
        const cards=page.locator('#order-list button'),ids=await cards.locator('strong').allTextContents(),index=ids.indexOf(order.orderId);assert.ok(index>=0);
        await cards.nth(index).click();await page.waitForFunction(id=>document.querySelector('#order-title')?.textContent===id,order.orderId);
        await picture(page,viewport,'order-reconciliation','#selected-order',{entire:true});
        await page.locator('#line-table tbody button').first().click();await picture(page,viewport,'line-contributions','#line-detail',{entire:true});await page.locator('#close-line').click();
        await page.locator('#order-tab-lines').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#order-tab-documents').getAttribute('aria-selected'),'true');
        await page.keyboard.press('End');assert.equal(await page.locator('#order-tab-parties').getAttribute('aria-selected'),'true');
        await picture(page,viewport,'parties-and-history','#tab-parties',{entire:true});await page.locator('#order-tab-documents').click();
        for(const doc of wantedDocuments){
          await inspectDocument(doc);assert.deepEqual(JSON.parse(await page.locator('#document-json').textContent()),(await api('/documents/'+encodeURIComponent(doc.id))).document);
          await picture(page,viewport,'document-'+doc.kind.toLowerCase(),'#document-detail',{entire:true});
          if(doc.kind!=='ORDER'&&await page.locator('#document-deliver').isEnabled()){
            await page.locator('#document-deliver').click();await picture(page,viewport,'prepare-'+doc.kind.toLowerCase(),'#transport-prepare-dialog',{entire:true});await closeDialog('transport-prepare-dialog');
          }
          await page.locator('#close-document').click();
        }
        await readAfter(()=>page.locator('#document-kind').selectOption(''),'/documents');await page.locator('#order-tab-drafts').click();
        await readAfter(()=>page.locator('#drafts-refresh').click(),'/drafts');await picture(page,viewport,'working-drafts','#tab-drafts',{entire:true});
        for(const draft of wantedDrafts){
          const saved=await api('/drafts/'+encodeURIComponent(draft.id));await openDraft(draft);assert.equal(await page.locator('#draft-document-id').inputValue(),saved.document.documentId);
          await picture(page,viewport,'editor-'+draft.kind.toLowerCase(),'#draft-editor',{entire:true});
          await page.locator('#draft-lines tbody button').first().click();await picture(page,viewport,'line-editor-'+draft.kind.toLowerCase(),'#draft-line-editor',{entire:true});
          const reason=(await page.locator('#draft-reason').inputValue())+'\nReviewed locally in the open editor';await page.locator('#draft-reason').fill(reason);
          await readAfter(()=>page.locator('#refresh').click(),'/drafts');
          assert.equal(await page.locator('#draft-reason').inputValue(),reason);assert.equal(await page.locator('#draft-document-id').inputValue(),saved.document.documentId);
          page.once('dialog',dialog=>dialog.accept());await page.locator('#close-draft').click();await page.locator('#draft-editor').waitFor({state:'hidden'});
          assert.deepEqual(await api('/drafts/'+encodeURIComponent(draft.id)),saved);
        }
      }
      await page.locator('#open-profile').click();await page.locator('#profile-dialog').waitFor({state:'visible'});
      await page.waitForFunction(hash=>document.querySelector('#profile-current')?.textContent.includes(hash),profile.profileSha256);
      assert.deepEqual(JSON.parse(await page.locator('#profile-complete').textContent()),profile.profile);assert.equal(await page.locator('#profile-fields').isDisabled(),!profile.canSelect);
      await picture(page,viewport,'customer-profile','#profile-dialog',{entire:true});
      if(!await page.locator('#profile-configuration').evaluate(el=>el.open))await page.locator('#profile-configuration > summary').click();
      await picture(page,viewport,'complete-interface-settings','#profile-configuration',{entire:true});await closeDialog('profile-dialog');
      await page.locator('#open-source').click();await picture(page,viewport,'receive-original-document','#source-dialog',{entire:true});
      await page.locator('#source-file').setInputFiles({name:'empty.xml',mimeType:'application/xml',buffer:Buffer.alloc(0)});await page.locator('#source-submit').click();
      const alert=page.locator('#source-dialog [data-dialog-notice][role="alert"]');await alert.waitFor({state:'visible'});assert.match(await alert.textContent(),/nonempty original XML/);
      await picture(page,viewport,'receive-file-validation','#source-dialog');await page.locator('#source-file').setInputFiles([]);await closeDialog('source-dialog');
      await page.locator('#open-transfer').click();await picture(page,viewport,'customer-handover','#transfer-dialog',{entire:true});await closeDialog('transfer-dialog');
      await page.locator('#open-transport').click();await page.locator('#transport-dialog').waitFor({state:'visible'});await ready(page);
      await picture(page,viewport,'delivery-list','#transport-dialog',{entire:true});
      for(const delivery of wantedTransmissions){
        await openDelivery(delivery,order?.orderId);await picture(page,viewport,'delivery-'+delivery.kind.toLowerCase(),'#transport-detail',{entire:true});await page.locator('#transport-close-detail').click();
      }
      await page.locator('#transport-tab-channels').click();await picture(page,viewport,'configured-channels','#transport-dialog',{entire:true});await closeDialog('transport-dialog');
      if(expected.captureGuides!==false){
        guidePage=await page.context().newPage();guidePage.on('pageerror',fault);await guidePage.emulateMedia({reducedMotion:'reduce'});await guidePage.setViewportSize({width:viewport.width,height:viewport.height});
        for(const key of GUIDES){
          await guidePage.goto(origin+'/guide?document='+key,{waitUntil:'networkidle'});await guidePage.locator('#guide-layout').waitFor({state:'visible'});
          assert.ok((await guidePage.locator('#guide-content').textContent()).trim().length>1000,'Complete installed guide '+key);
          assert.equal(new URL(await guidePage.locator('#guide-source').getAttribute('href'),origin).pathname,'/guide/'+key+'.md');
          await picture(guidePage,viewport,'guide-'+key,'body');
          if(await guidePage.locator('#guide-content table').count())await picture(guidePage,viewport,'guide-'+key+'-table','#guide-content table');
          if(await guidePage.locator('#guide-content pre').count())await picture(guidePage,viewport,'guide-'+key+'-commands','#guide-content pre');
        }
        await guidePage.close();guidePage=null;
      }
      checks.push({viewport:viewport.name,order:order?.orderId??null,documentKinds:wantedDocuments.map(d=>d.kind),draftKinds:wantedDrafts.map(d=>d.kind),deliveryKinds:wantedTransmissions.map(d=>d.kind),documents:wantedDocuments.map(({id,kind,documentId,revision})=>({id,kind,documentId,revision})),drafts:wantedDrafts.map(({id,kind,revision})=>({id,kind,revision})),transmissions:wantedTransmissions.map(({id,kind,revision})=>({id,kind,revision})),unsavedDraftsPreserved:!!order,inDialogValidationVisible:true,keyboardTabs:!!order});
    }
    assert.deepEqual(await api('/state'),before,'Read-only buyer review preserves complete workspace state.');
    assert.deepEqual(writes,[],'Buyer capture must not submit workspace writes.');assert.deepEqual(faults,[],'Actual browser page errors.');
    const report={schema:SUPPLIER_ORDER_BUYER_REVIEW_SCHEMA,role,assetSha256,assets,workspaceId:before.workspaceId,orderId:order?.orderId??null,profileSha256:profile.profileSha256,capturedAt:new Date().toISOString(),viewports:VIEWPORTS,checks,screens,pageErrors:faults,workspaceWrites:writes,artifacts:[...artifacts]};
    const file=await keep(join(root,'buyer-review.json'),json(report));return{...report,file};
  }finally{if(guidePage)await guidePage.close();page.off('pageerror',fault);page.off('request',request);}
}
