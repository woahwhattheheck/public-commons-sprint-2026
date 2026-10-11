import assert from 'node:assert/strict';
import {once} from 'node:events';
import vm from 'node:vm';
import {start} from './server.mjs';
import {DEMO} from './engine.mjs';

// One native HTTP workflow plus the shipped module scripts in an HTML-derived
// minimal DOM. This exercises state/data behavior, not browser rendering.
const server=start({port:0,host:'127.0.0.1'});
await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
let cookie='';
async function request(path,body,sessionCookie=cookie){
  const response=await fetch(base+path,{method:body?'POST':'GET',
    headers:{cookie:sessionCookie,origin:base,'content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(sessionCookie===cookie)cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;
  return {status:response.status,data:await response.json()};
}
async function action(action,params={}){
  const result=await request('/api/action',{action,...params});
  assert.equal(result.status,200,JSON.stringify(result.data));
  return result.data;
}

async function browserScript(){
  const html=await (await fetch(base)).text();
  const nodes=new Map(),pending=new Set(),downloads=[],reports=[];
  let delay=null;
  function element(){
    let value='';
    const listeners=new Map();
    const node={get value(){return value},set value(next){value=String(next)},
      checked:false,disabled:false,hidden:false,textContent:'',className:'',style:{},children:[],attributes:{},
      replaceChildren(...children){this.children=[...children]},append(...children){this.children.push(...children)},
      appendChild(child){this.children.push(child);return child},remove(){},focus(){},
      setAttribute(key,value){this.attributes[key]=String(value)},removeAttribute(key){delete this.attributes[key]},
      addEventListener(name,listener){listeners.set(name,[...(listeners.get(name)||[]),listener])},
      async fire(name){const event={preventDefault(){},target:node};
        if(this['on'+name])await this['on'+name](event);
        for(const listener of listeners.get(name)||[])await listener(event);},
      click(){downloads.push({href:this.href,download:this.download})},
      reportValidity(){return true}};
    return node;
  }
  for(const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const [,tag,attrs,id]=match,n=element();
    n.value=attrs.match(/\bvalue="([^"]*)"/)?.[1]||'';
    n.checked=/\bchecked\b/.test(attrs);n.disabled=/\bdisabled\b/.test(attrs);n.hidden=/\bhidden\b/.test(attrs);
    nodes.set(id,n);
  }
  const document={getElementById(id){assert.ok(nodes.has(id),'missing DOM id '+id);return nodes.get(id)},
    createElement:element,body:element()};
  const blobs=new Map();let objectId=0;
  const localURL={createObjectURL(blob){const key='blob:fixture-'+(++objectId);blobs.set(key,blob);return key},revokeObjectURL(){}};
  const context=vm.createContext({document,AbortController,Blob,URL:localURL,setTimeout,clearTimeout,console,
    fetch(path,options={}){
      const currentDelay=path==='/api/robustness'?delay:null;
      const work=(async()=>{
        const response=await fetch(base+path,{...options,headers:{...options.headers,cookie,origin:base}});
        const data=await response.json();
        if(path==='/api/robustness'&&response.ok)reports.push(data);
        if(currentDelay){currentDelay.arrived();await currentDelay.promise;}
        return {ok:response.ok,status:response.status,json:async()=>data};
      })();
      pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
    }});
  const moduleCache=new Map();
  async function module(name){
    if(moduleCache.has(name))return moduleCache.get(name);
    assert.ok(['/app.js','/robustness-ui.js'].includes(name),'unexpected module '+name);
    const source=await (await fetch(base+name)).text();
    const m=new vm.SourceTextModule(source,{context,identifier:name});moduleCache.set(name,m);
    await m.link(specifier=>module('/'+specifier.replace(/^\.\//,'')));
    return m;
  }
  async function settle(){
    while(pending.size)await Promise.allSettled([...pending]);
    await new Promise(resolve=>setImmediate(resolve));
  }
  await (await module('/app.js')).evaluate();await settle();
  return {$:id=>document.getElementById(id),downloads,blobs,reports,settle,
    delayNext(){let release,arrived;const promise=new Promise(resolve=>release=resolve);
      const ready=new Promise(resolve=>arrived=resolve);delay={promise,arrived};
      return {ready,release(){delay=null;release();}};}};
}

try{
  const first=await action('propose',{input:DEMO});
  await action('approve',{id:first.proposal.id});
  const before=(await request('/api/state')).data;
  const alternatives=[{name:'Hypothetical changed bands',prices:Array.from({length:24},(_,h)=>h>=17&&h<21?0.1:(h>=21||h<7)?1:0.5)}];
  const comparison=await request('/api/robustness',{proposalId:first.proposal.id,alternatives});
  assert.equal(comparison.status,200);
  assert.equal(comparison.data.proposalId,first.proposal.id);
  assert.equal(comparison.data.report.original.optimizedCostUsd,first.proposal.optimized.cost);
  assert.ok(comparison.data.report.alternatives[0].regretUsd>0);
  assert.ok(comparison.data.report.alternatives[0].moves.length>0);
  assert.deepEqual((await request('/api/state')).data,before,'comparison cannot alter approval, history or receipt');
  const invalid=await request('/api/robustness',{proposalId:first.proposal.id,alternatives:[{name:'Invalid',prices:[1]}]});
  assert.equal(invalid.status,400);
  const foreign=await request('/api/robustness',{proposalId:first.proposal.id,alternatives},'gridkind_sid=00000000-0000-0000-0000-000000000000');
  assert.equal(foreign.status,409,'other session cannot compare this proposal');
  const ui=await browserScript();
  assert.equal(ui.$('execute').disabled,false,'original approval remains usable');
  for(const [band,value] of Object.entries({offpeak:'1',standard:'0.5',peak:'0.1'}))
    ui.$('robustness-'+band).value=value;
  await ui.$('robustness-form').fire('input');
  await ui.$('robustness-form').fire('submit');
  const report=ui.reports.at(-1).report;
  assert.equal(ui.$('robustness-results').className,'');
  assert.equal(ui.$('robustness-retained').textContent,'$'+report.alternatives[0].retainedScheduleCostUsd.toFixed(4));
  assert.equal(ui.$('robustness-moves').children.length,report.alternatives[0].moves.length);
  assert.equal(ui.$('robustness-export').disabled,false);
  await ui.$('robustness-export').fire('click');
  const download=ui.downloads.at(-1);
  assert.ok(download.download.includes(first.proposal.id));
  assert.equal(await ui.blobs.get(download.href).text(),JSON.stringify(report,null,2)+'\n');
  assert.deepEqual((await request('/api/state')).data,before,'browser comparison and download are read-only');

  ui.$('robustness-offpeak').value='';
  await ui.$('robustness-form').fire('input');
  await ui.$('robustness-form').fire('submit');
  assert.equal(ui.$('robustness-offpeak').value,'','validation preserves the draft');
  assert.match(ui.$('robustness-error').textContent,/Complete all three/);
  assert.equal(ui.$('robustness-export').disabled,true);
  ui.$('robustness-offpeak').value='1';
  await ui.$('robustness-form').fire('input');
  const gate=ui.delayNext();
  const pending=ui.$('robustness-form').fire('submit');
  await gate.ready;
  ui.$('robustness-offpeak').value='0.75';
  await ui.$('robustness-form').fire('input');
  gate.release();await pending;
  assert.equal(ui.$('robustness-results').className,'only-hidden','late reply cannot revive stale rates');
  assert.equal(ui.$('robustness-export').disabled,true);
  assert.equal(ui.$('robustness-offpeak').value,'0.75');

  ui.$('rate-offpeak').value='0.2';await ui.$('scenario-form').fire('input');
  assert.equal(ui.$('robustness-compare').disabled,true,'dirty main scenario cannot use old proposal');
  await ui.$('plan').fire('click');
  const replacement=(await request('/api/state')).data;
  assert.notEqual(replacement.proposal.id,first.proposal.id);
  assert.equal(replacement.approved,false,'replan still requires original explicit approval');
  assert.equal(ui.$('robustness-offpeak').value,'0.75','new proposal retains alternative draft');
  assert.equal((await request('/api/robustness',{proposalId:first.proposal.id,alternatives})).status,409);
  await ui.$('robustness-reset').fire('click');
  await ui.$('robustness-form').fire('submit');
  assert.equal(ui.$('robustness-opportunity').textContent,'$0.0000');
  assert.equal(ui.$('robustness-empty').textContent,'No loads move in the hypothetical replan.');
  assert.equal(ui.$('robustness-empty').className,'dim');
  await ui.$('cancel').fire('click');
  assert.equal((await request('/api/robustness',{proposalId:replacement.proposal.id,alternatives})).status,409);
  assert.equal(ui.$('robustness-export').disabled,true);
  console.log(JSON.stringify({status:'passed',native_http:true,shipped_module_workflow:true,
    retained_cost:report.alternatives[0].retainedScheduleCostUsd,
    replanned_cost:report.alternatives[0].freshlyOptimizedCostUsd,
    moved_loads:report.alternatives[0].moves.length,
    export_exact:true,stale_reply_ignored:true,proposal_approval_preserved:true,
    cross_session_rejected:409,stale_proposal_rejected:409,browser_rendered:false,external_device_calls:0}));
}finally{
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
}
