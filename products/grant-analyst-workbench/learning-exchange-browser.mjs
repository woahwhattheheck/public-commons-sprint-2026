// SPDX-License-Identifier: MIT
// Complete Learning exchange controls on the original retained browser owner.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {BrowserCourse} from './receiving-browser.mjs';
import * as X from './learning-exchange.mjs';

const need=(yes,message)=>{if(!yes)throw Object.assign(new Error(message),{code:'LEARNING_EXCHANGE_RECEIVING'});};
const same=(a,b)=>X.canonical(a)===X.canonical(b);
const sha=s=>createHash('sha256').update(s).digest('hex');
const read=async row=>{const raw=await readFile(row.path);need(raw.length===row.bytes&&sha(raw)===row.sha256,'Retain the full selected exchange bytes.');return raw.toString('utf8');};

export function createLearningExchangeReceivingBrowser(options){
  need(options.exchange&&['operate','reopen'].includes(options.exchange.mode),'Select the complete exchange journey.');
  return new LearningExchangeBrowser({...options,extension:{schema:'stellar-forge.learning-exchange-browser.v1',...options.exchange}});
}
export class LearningExchangeBrowser extends BrowserCourse{
  async document(name,value){
    return this.publishCandidate(name,async()=>({bytes:Buffer.from(X.canonical(value)),metadata:{kind:'complete-exchange-json'}}));
  }
  async retainedJson(row){return JSON.parse(await read(row));}
  async localLedger(){
    const value=await this.page.evaluate(async workspaceId=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('tjlabs-grant-analyst-learning-exchange',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try{return await new Promise((resolve,reject)=>{const t=db.transaction('workspaces','readonly'),r=t.objectStore('workspaces').get(workspaceId);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
    },this.o.workspaceId);
    need(value?.workspaceId===this.o.workspaceId,'Open the original hosted exchange ledger.');return value;
  }
  async ready(){
    await this.page.locator('#learning-exchange').waitFor();
    await this.page.waitForFunction(id=>document.querySelector('#exchange-workspace')?.textContent.includes(id)&&!document.querySelector('#exchange-refresh')?.disabled,this.o.workspaceId);
  }
  async idle(){await this.page.waitForFunction(()=>!document.querySelector('#exchange-refresh')?.disabled);}
  async importFile(row){
    await read(row);await this.page.locator('#exchange-import').setInputFiles(row.path);
    await this.page.locator('#exchange-import-button').click();await this.idle();
    need(!(await this.page.locator('#exchange-notice').getAttribute('class')).includes('error'),'The complete exchange import was rejected.');
  }
  async select(value,key){
    const row=await this.document(key+'-selected.json',value);await this.importFile(row);return row;
  }
  async bundle(key){
    const file=await this.downloaded(key+'.json',()=>this.page.locator('#exchange-export').click());
    const value=X.inspectBundle(await this.retainedJson(file));need(value.packets.every(p=>X.inspectPacket(p).context.workspaceId===this.o.workspaceId),'The exported exchange belongs to another workspace.');
    return{file,value};
  }
  async contextViews(key,page=this.page,offline=false){
    const select=page.locator(offline?'#context-select':'#exchange-section');
    const choices=await select.locator('option').evaluateAll(rows=>rows.map(n=>({value:n.value,label:n.textContent})));
    const files=[];
    for(let i=0;i<choices.length;i++){
      await select.selectOption(choices[i].value);
      const file=await this.downloaded(key+'-context-'+i+'.json',()=>page.locator(offline?'#context-download':'#exchange-context-download').click(),page);
      const literal=await read(file);need(literal.length>0,'A complete selected context is empty.');
      files.push({selection:choices[i],file});
    }
    await this.screenshot(key+'-context.png',page);return files;
  }
  async issue(key,selection){
    return this.phase(key+'-issued',async()=>{
      await this.ready();
      const instructions='Installed receiving '+sha(this.root+'\0'+key)+'. Review the complete retained source. Preserve business statuses and definitions; record only the technical receiving note and its evidence.';
      const ledger=await this.localLedger(),previous=ledger.packets.filter(p=>p.instructions===instructions);
      need(previous.length<=1,'Keep the one original issued packet for this receiving phase.');
      let html,packet;
      if(previous.length){
        packet=previous[0];await this.select(packet,key+'-recovered-packet');
        html=await this.downloaded(key+'-issued.html',()=>this.page.locator('#exchange-offline').click());
      }else{
        await this.page.locator('#exchange-mode').selectOption(selection.mode);
        await this.page.locator('#exchange-cycle').selectOption(selection.cycle);
        if(selection.mode==='action')await this.page.locator('#exchange-action').selectOption(selection.action);
        else{
          await this.page.locator('#exchange-edition').selectOption(selection.edition);
          await this.page.locator('#exchange-grants').fill(selection.grantIds.join('\n'));
        }
        await this.page.locator('#exchange-issuer').fill(this.o.actor);
        await this.page.locator('#exchange-recipient').fill(this.o.actor);
        await this.page.locator('#exchange-instructions').fill(instructions);
        html=await this.downloaded(key+'-issued.html',()=>this.page.locator('#exchange-issue').click());
        await this.idle();
        const rows=(await this.localLedger()).packets.filter(p=>p.instructions===instructions);
        need(rows.length===1,'The hosted issue must retain exactly one full packet.');packet=rows[0];
      }
      X.inspectPacket(packet);need(same(X.inspectPacket(packet).context.selection,selection),'The issued original source selection changed.');
      const file=await this.document(key+'-packet.json',packet);
      await this.screenshot(key+'-hosted-issued.png');const contexts=await this.contextViews(key+'-hosted');
      return{packet,file,html,contexts};
    });
  }
  async offlinePage(html,work){
    await read(html);this.checkStopping();const acquiring=this.context.newPage();this.pageAcquisitions.add(acquiring);let page;
    try{
      page=await acquiring;this.checkStopping();page.setDefaultTimeout(60000);
      page.on('pageerror',e=>{this.state.errors.push({type:'pageerror',message:e.message,source:html.path,at:new Date().toISOString()});void this.save().catch(()=>{});});
      await page.goto(pathToFileURL(html.path).href,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>globalThis.LearningExchange&&document.querySelector('#actions fieldset')&&!document.querySelector('#save')?.disabled);
      need(await page.locator('#recovery').isHidden(),'Preserve the independently saved draft branches before choosing another draft.');
      return await work(page);
    }finally{this.pageAcquisitions.delete(acquiring);if(page)await page.close();}
  }
  async offline(key,issued,{review=false}={}){
    return this.phase(key+'-offline-complete',async()=>{
      let current=issued;
      return this.offlinePage(current.html,async page=>{
        const before=X.inspectPacket(current.packet),marker='Technical receiving: '+key+'. Complete original context '+current.packet.contextSha256+'.';
        await page.locator('#reviewer').fill(this.o.actor);
        if(review){
          await page.locator('#review-id').fill('receiving-'+sha(this.root+'\0'+key).slice(0,24));
          await page.locator('#interpretation').fill('Technical receiving review of the complete retained cycle and its current grant evidence. Business statuses and definitions are preserved; no new programme effectiveness claim is made.');
          await page.locator('#limitations').fill('This receiving course verifies complete context, review transport, explicit application and native history. It does not add field observations or substitute for the original analyst conclusions.');
        }
        const boxes=page.locator('#actions fieldset');
        need(await boxes.count()===(review?before.context.cycle.actions.length:1),'The offline form must contain every selected original action.');
        const ids=await boxes.evaluateAll(rows=>rows.map(n=>n.dataset.action));
        for(const id of ids){
          // Select by the literal retained action ID, without interpreting it as CSS.
          const fieldset=boxes.nth(ids.indexOf(id));
          const original=before.context.cycle.actions.find(x=>x.id===id).revisions.at(-1);
          for(const field of ['title','owner','dueOn','successCriteria','status'])
            need(await fieldset.locator('[data-field="'+field+'"]').inputValue()===original[field],'Offline business definition changed: '+field);
          await fieldset.locator('[data-field="note"]').fill(marker+' Action '+id+'.');
          await fieldset.locator('[data-field="evidence"]').fill('Original source context SHA-256 '+current.packet.contextSha256+'; all source text and earlier reviews are retained in this file.');
        }
        const draft=await this.downloaded(key+'-draft.json',()=>page.locator('#save').click(),page);
        const draftValue=X.inspectDraft(await this.retainedJson(draft));
        need(draftValue.decision.reviewer===this.o.actor&&draftValue.decision.actions.every(a=>a.note.includes(marker)),'The complete current draft was not exported.');
        const html=await this.downloaded(key+'-saved.html',()=>page.locator('#html').click(),page);
        const contexts=await this.contextViews(key+'-offline',page,true);
        const desktop=await this.screenshot(key+'-offline-desktop.png',page);
        await page.setViewportSize({width:390,height:844});const narrow=await this.screenshot(key+'-offline-narrow.png',page);
        await page.setViewportSize({width:1440,height:1000});
        const reopened=await this.offlinePage(html,async reopened=>{
          need(await reopened.locator('#reviewer').inputValue()===this.o.actor,'The saved offline HTML lost its draft.');
          const retained=await this.downloaded(key+'-reopened-draft.json',()=>reopened.locator('#save').click(),reopened);
          const value=X.inspectDraft(await this.retainedJson(retained));
          need(same(value.decision,draftValue.decision)&&value.draft.history.slice(0,draftValue.draft.history.length).every((x,i)=>same(x,draftValue.draft.history[i])),'Portable HTML changed the full retained draft history.');
          const returned=await this.downloaded(key+'-return.json',()=>reopened.locator('#return').click(),reopened);
          const r=X.inspectReturn(await this.retainedJson(returned));
          need(same(r.decision,draftValue.decision),'The returned decision differs from the saved/reopened draft.');
          const screenshot=await this.screenshot(key+'-offline-reopened.png',reopened);
          return{returned,value:r.returned,screenshot,draft:retained};
        });
        return{issued:current,draft,html,contexts,desktop,narrow,...reopened};
      });
    });
  }
  async importedReturn(key,returned){
    await this.importFile(returned.returned??returned);
    await this.page.locator('#exchange-compare').click();await this.idle();
    await this.screenshot(key+'-comparison.png');return this.page.locator('#exchange-apply').isEnabled();
  }
  async resumeOperation(op){
    const row=this.page.locator('#exchange-operations .exchange-operation').filter({hasText:op.request.body.requestId});
    need(await row.count()===1,'Reopen the exact retained native request.');await row.locator('button').click();await this.idle();
  }
  async apply(key,returned,{uncertain=false}={}){
    return this.phase(key+'-applied',async()=>{
      const value=X.inspectReturn(await this.retainedJson(returned.returned??returned)).returned;
      await this.ready();let ledger=await this.localLedger(),op=ledger.operations.find(x=>x.returnSha256===value.sha256);
      this.state.exchange??={};this.state.exchange[key]??={stage:0};await this.save();
      const saved=this.state.exchange[key];
      const routePattern='**/api/cycle-*',receiptPattern='**/_merchant/learning-exchange/receipt?*';
      const handler=route=>{
        const task=(async()=>{
          const wire=route.request().postDataJSON();
          if(route.request().method()!=='POST'||!wire?._merchantLearningExchange||wire._merchantLearningExchange.returnSha256!==value.sha256)return route.continue();
          const action=new URL(route.request().url()).pathname.split('/').at(-1);
          const request={action,body:wire};
          if(saved.request)need(same(saved.request,request),'Resume the exact original exchange request.');
          else{saved.request=request;await this.save();await this.document(key+'-native-request.json',request);}
          if(uncertain&&saved.stage===0){saved.stage=1;await this.save();return route.abort('failed');}
          const response=await route.fetch({timeout:120000}),raw=await response.body();
          const file=await this.publishCandidate(key+'-native-response.json',async()=>({bytes:raw,metadata:{status:response.status()}}));
          need(response.ok(),'The original guarded writer rejected the returned decision.');
          saved.response=file;saved.result=JSON.parse(raw.toString('utf8'));saved.stage=2;
          const lose=uncertain&&!saved.lostResponse;if(lose)saved.lostResponse=true;await this.save();
          if(lose)return route.abort('failed');
          return route.fulfill({response,body:raw});
        })();this.routes.add(task);task.finally(()=>this.routes.delete(task)).catch(()=>{});return task;
      };
      const receiptHandler=route=>saved.allowReceipt||!uncertain||saved.stage<2?route.continue():route.abort('failed');
      await this.page.route(routePattern,handler);await this.page.route(receiptPattern,receiptHandler);
      try{
        if(!op){
          need(await this.importedReturn(key,returned),'Review current context before applying this return.');
          await this.page.locator('#exchange-apply').click();await this.idle();
          ledger=await this.localLedger();op=ledger.operations.find(x=>x.returnSha256===value.sha256);
          need(op,'The hosted writer must retain its operation before dispatch.');
        }
        if(uncertain&&saved.stage<2){
          // The first request was saved locally but deliberately not dispatched.
          // Export and import canonical JSON while the original pending object
          // retains its literal property order, then resume that same UUID.
          const bundle=await this.bundle(key+'-saved-before-dispatch');
          saved.pendingBundle=bundle.file;await this.save();
          await this.page.reload({waitUntil:'domcontentloaded'});await this.ready();await this.importFile(bundle.file);
          await this.resumeOperation(op);
          need(saved.stage===2&&saved.lostResponse,'The actual native write must close before its response is lost.');
          const uncertainBundle=await this.bundle(key+'-saved-after-lost-response');saved.uncertainBundle=uncertainBundle.file;await this.save();
          await this.screenshot(key+'-uncertain-original-request.png');
        }
        saved.allowReceipt=true;await this.save();
        await this.page.reload({waitUntil:'domcontentloaded'});await this.ready();
        if(saved.uncertainBundle)await this.importFile(saved.uncertainBundle);
        await this.resumeOperation(op);
        const final=await this.localLedger(),application=final.applications.find(x=>x.operationId===op.id);
        need(application&&same(application.request,op.request),'Retain the complete original request and native receipt.');
        need(await this.page.evaluate(()=>!pending&&!requestInFlight),'The same confirmed original pending request was not reconciled.');
        const full=await this.bundle(key+'-applied-bundle');
        need(full.value.applications.some(x=>same(x,application)),'The portable bundle omitted the actual native receipt.');
        const native=await this.api('/_merchant/learning-exchange/receipt?requestId='+encodeURIComponent(op.request.body.requestId));
        need(same(native.receipt,application.receipt),'Reopening the original native receipt changed it.');
        await this.screenshot(key+'-saved-result.png');
        return{operation:op,application,bundle:full.file,recovery:JSON.parse(JSON.stringify(saved))};
      }finally{await this.page.unroute(routePattern,handler).catch(e=>{if(!this.stopping)throw e;});await this.page.unroute(receiptPattern,receiptHandler).catch(e=>{if(!this.stopping)throw e;});}
    });
  }
  async rebase(key,stale){
    return this.phase(key+'-explicit-rebase',async()=>{
      const reason='Explicit technical receiving reconciliation: retain the full newer workspace history, use this returned technical note and its complete source evidence, and preserve business definitions/statuses.';
      const prior=(await this.localLedger()).drafts.filter(d=>d.packet.rebase?.parentReturn.sha256===stale.value.sha256&&d.packet.rebase.reason===reason);
      const unique=[...new Map(prior.map(d=>[d.packet.sha256,d])).values()];
      need(unique.length<=1,'Reopen the one saved rebase of this original return.');
      let html,choices;
      if(unique.length){
        const checked=X.inspectDraft(unique[0]);choices=checked.packet.rebase.choices;
        await this.select(checked.draft,key+'-recovered-rebase');
        html=await this.downloaded(key+'-rebased.html',()=>this.page.locator('#exchange-offline').click());
      }else{
        need(!await this.importedReturn(key,stale),'The stale return must require explicit current-context review.');
        const controls=this.page.locator('#exchange-comparison select[data-action][data-field]');choices={context:'accept-current-context',actions:{}};
        for(let i=0;i<await controls.count();i++){
          const c=controls.nth(i),id=await c.getAttribute('data-action'),field=await c.getAttribute('data-field');
          (choices.actions[id]??={})[field]='returned';await c.selectOption('returned');
        }
        need(Object.keys(choices.actions).length>0,'The course must expose an actual changed action-field conflict.');
        await this.document(key+'-explicit-choices.json',{parentReturn:stale.value.sha256,reviewer:this.o.actor,reason,choices});
        await this.page.locator('#exchange-accept-context').check();await this.page.locator('#exchange-rebase-reviewer').fill(this.o.actor);
        await this.page.locator('#exchange-rebase-reason').fill(reason);
        html=await this.downloaded(key+'-rebased.html',()=>this.page.locator('#exchange-rebase').click());await this.idle();
      }
      const htmlText=await read(html),match=htmlText.match(/<script[^>]+id=["']exchange-payload["'][^>]*>([\s\S]*?)<\/script>/i);
      need(match,'The complete offline rebase payload is absent.');
      const checked=X.inspectDraft(JSON.parse(match[1]));
      const selected=await this.document(key+'-rebased.json',checked.draft);await this.importFile(selected);
      need(checked.packet.rebase&&checked.packet.rebase.parentReturn.sha256===stale.value.sha256&&same(checked.packet.rebase.choices,choices),'The rebase must retain the entire original return and exact explicit choices.');
      await this.screenshot(key+'-explicit-rebase.png');
      return{packet:checked.packet,draft:selected,html,choices};
    });
  }
  async reopen(){
    const selected=this.o.exchange.bundle,expected=X.inspectBundle(await this.retainedJson(selected));
    await this.importFile(selected);
    for(const op of expected.operations){
      const application=expected.applications.find(a=>a.operationId===op.id);
      need(application,'The final handover must contain a native receipt for each selected operation.');
      await this.resumeOperation(op);
      const receipt=await this.api('/_merchant/learning-exchange/receipt?requestId='+encodeURIComponent(op.request.body.requestId));
      need(same(receipt.receipt,application.receipt),'The independent native archive lost an original exchange receipt.');
    }
    const bundle=await this.bundle('independent-complete-exchange');
    for(const key of ['packets','drafts','returns','operations','applications'])
      need(expected[key].every(row=>bundle.value[key].some(actual=>same(row,actual))),'Independent reopening lost full '+key+'.');
    for(const returned of expected.returns){
      await this.select(returned,'reopen-'+returned.sha256);
      await this.contextViews('reopen-context-'+returned.sha256.slice(0,12));
    }
    const desktop=await this.screenshot('exchange-independent-desktop.png'),narrow=await this.narrow('exchange-independent-narrow.png');
    return{bundle:bundle.file,desktop,narrow,operations:expected.operations,applications:expected.applications};
  }
  async journey(){
    await this.ready();
    const initial=await this.phase('exchange-original-screens',async()=>({desktop:await this.screenshot('exchange-desktop.png'),mobile:await this.narrow('exchange-narrow.png')}));
    let exchange;
    if(this.o.exchange.mode==='reopen')exchange=await this.phase('exchange-full-independent-reopen',()=>this.reopen());
    else{
      const cycle=this.baseline.state.learningCycles.find(c=>c.actions.length);
      need(cycle,'Use the original completed Learning cycle.');
      const selection={mode:'action',cycle:cycle.id,action:cycle.actions[0].id};
      const first=await this.issue('action-one',selection),returned=await this.offline('action-one',first);
      const applied=await this.apply('action-one',returned,{uncertain:true});
      const stale=await this.issue('stale-action',selection),staleReturn=await this.offline('stale-action',stale);
      const current=await this.issue('current-action',selection),currentReturn=await this.offline('current-action',current);
      const currentApplied=await this.apply('current-action',currentReturn);
      const rebased=await this.rebase('stale-action',staleReturn),rebasedReturn=await this.offline('rebased-action',rebased);
      const rebasedApplied=await this.apply('rebased-action',rebasedReturn);
      const snapshot=cycle.reviews.at(-1)?.snapshot??cycle.baseline;
      const reviewSelection={mode:'review',cycle:cycle.id,edition:snapshot.report.edition.id,grantIds:snapshot.references};
      need(Array.isArray(reviewSelection.grantIds)&&reviewSelection.grantIds.length,'Retain the actual original reviewed grant references.');
      const review=await this.issue('whole-cycle',reviewSelection),reviewReturn=await this.offline('whole-cycle',review,{review:true});
      const reviewApplied=await this.apply('whole-cycle',reviewReturn);
      const bundle=await this.bundle('complete-exchange');
      const operations=[applied,currentApplied,rebasedApplied,reviewApplied];
      need(new Set(operations.map(x=>x.operation.request.body.requestId)).size===4,'Every explicit application keeps its distinct original request.');
      exchange={initial,first,returned,applied,stale,staleReturn,current,currentReturn,currentApplied,rebased,rebasedReturn,rebasedApplied,review,reviewReturn,reviewApplied,bundle:bundle.file,
        operations:operations.map(x=>x.operation),applications:operations.map(x=>x.application)};
    }
    const handover=await this.phase('exchange-complete-native-handover',()=>this.downloaded('exchange-native-handover.zip',()=>this.page.locator('#export').click()));
    const projection=await this.phase('exchange-final-native-projection',async()=>this.document('exchange-final-projection.json',{
      state:await this.api('/api/state'),learning:await this.api('/api/learning'),studies:await this.api('/api/studies')}));
    return{initial,exchange,handover,projection,edit:null,grants:[],learning:null,studies:null,textReports:[]};
  }
}
