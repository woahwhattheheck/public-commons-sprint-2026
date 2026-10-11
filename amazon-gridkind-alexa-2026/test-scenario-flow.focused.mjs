import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import vm from 'node:vm';
import {makeAgent} from './agent.mjs';
import {DEMO,plan} from './engine.mjs';
import {start} from './server.mjs';

const custom=()=>({
  prices:Array.from({length:24},(_,h)=>h>=17&&h<21?0.1:(h>=21||h<7)?0.5:0.2),
  maxKw:1.5,
  tasks:[
    {...DEMO.tasks[0],hours:1,deadline:20},
    {...DEMO.tasks[1],kw:0.8,earliest:16,deadline:22},
  ],
});

test('real HTTP custom scenario survives voice planning and requires fresh exact approval',async t=>{
  const server=start({port:0,host:'127.0.0.1'});
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  let cookie='';
  async function api(action,params={}){
    const response=await fetch(base+(action?'/api/action':'/api/state'),{
      method:action?'POST':'GET',
      headers:{cookie,origin:base,'content-type':'application/json'},
      ...(action?{body:JSON.stringify({action,...params})}:{}),
    });
    cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;
    return {status:response.status,data:await response.json()};
  }
  assert.equal((await api()).data.status,'empty');
  const input=custom();
  const first=(await api('say',{command:'Find a cheaper schedule',input})).data;
  assert.deepEqual(first.scenario,input);
  assert.deepEqual(first.proposal.optimized,plan(input).optimized);
  assert.equal((await api('approve',{id:first.proposal.id})).data.approved,true);
  const second=(await api('say',{command:'Plan again'})).data;
  assert.deepEqual(second.scenario,input,'voice replan must retain custom settings');
  assert.notEqual(second.proposal.id,first.proposal.id);
  assert.equal(second.approved,false);
  assert.equal((await api('approve',{id:first.proposal.id})).status,400);
  assert.equal((await api('execute',{id:second.proposal.id})).status,400);
  assert.equal((await api('propose',{input:{...input,maxKw:0.5}})).status,400);
  assert.equal((await api()).data.proposal.id,second.proposal.id,'invalid input cannot replace plan');
  await api('approve',{id:second.proposal.id});
  const execution=(await api('execute',{id:second.proposal.id})).data;
  assert.equal(execution.receipt.liveDeviceCalls,0);
  assert.equal(execution.receipt.simulated,true);
  assert.equal(execution.receipt.commands.length,2);
  assert.deepEqual((await api('execute',{id:second.proposal.id})).data,execution);
  await api('cancel');
  assert.deepEqual((await api()).data.scenario,input,'clear plan retains editor settings');
});

async function browserScript(agent){
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const nodes=new Map(),defaults=new Map(),requests=[];
  function element(){
    let value='';
    return {get value(){return value},set value(next){value=String(next)},
      checked:false,disabled:false,textContent:'',className:'',style:{},children:[],
      replaceChildren(){this.children=[]},append(...children){this.children.push(...children)}};
  }
  for(const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const [,tag,attrs,id]=match,n=element();
    n.value=attrs.match(/\bvalue="([^"]*)"/)?.[1]||'';
    n.checked=/\bchecked\b/.test(attrs);n.disabled=/\bdisabled\b/.test(attrs);
    nodes.set(id,n);
    if(tag==='input')defaults.set(id,{value:n.value,checked:n.checked});
  }
  const document={getElementById:id=>{assert.ok(nodes.has(id),'missing DOM id '+id);return nodes.get(id)},
    createElement:element};
  const $=id=>document.getElementById(id);
  $('scenario-form').reportValidity=()=>true; // Server owns actual numeric/window validation.
  $('scenario-form').reset=()=>{for(const [id,value]of defaults)Object.assign($(id),value)};
  const fetch=async(path,options)=>{
    try{
      let result;
      if(path==='/api/state')result=agent.view();
      else{
        const body=JSON.parse(options.body);requests.push(body);
        const {action,input,id,command}=body;
        const operations={propose:()=>agent.offer(input),say:()=>agent.say(command,input),
          approve:()=>agent.approve(id),execute:()=>agent.execute(id),cancel:()=>agent.cancel()};
        result=operations[action]();
      }
      return {ok:true,json:async()=>structuredClone(result)};
    }catch(error){return {ok:false,json:async()=>({error:error.message})};}
  };
  vm.runInNewContext(source,{document,fetch});
  await new Promise(resolve=>setImmediate(resolve));
  return {$,requests,edit(id,value){
    if(typeof value==='boolean')$(id).checked=value;else $(id).value=value;
    $('scenario-form').oninput();
  }};
}

test('shipped browser script edits, replans, approves and simulates the custom flow',async()=>{
  const agent=makeAgent(),ui=await browserScript(agent),{$}=ui;
  ui.edit('max-kw','1.5');ui.edit('ev-topup-enabled',false);
  ui.edit('rate-offpeak','0.50');ui.edit('rate-standard','0.20');ui.edit('rate-peak','0.10');
  ui.edit('laundry-hours','1');ui.edit('laundry-deadline','20');
  ui.edit('dishwasher-kw','0.8');ui.edit('dishwasher-earliest','16');ui.edit('dishwasher-deadline','22');
  await $('plan').onclick();
  assert.deepEqual(agent.view().scenario,custom());
  assert.equal($('approve').disabled,false);
  await $('approve').onclick();
  const original=agent.view().proposal.id;
  assert.equal($('execute').disabled,false);
  ui.edit('laundry-hours','3');
  assert.equal($('approve').disabled,true);assert.equal($('execute').disabled,true);
  const requestCount=ui.requests.length;
  await $('execute').onclick();
  assert.equal(ui.requests.length,requestCount,'dirty editor must block dispatch even if clicked programmatically');
  assert.equal(agent.view().receipt,null);
  await $('plan').onclick();
  assert.notEqual(agent.view().proposal.id,original);
  assert.equal(agent.view().approved,false);
  await $('approve').onclick();await $('execute').onclick();
  assert.equal(agent.view().receipt.commands.length,2);
  assert.equal(agent.view().receipt.liveDeviceCalls,0);
  assert.match($('receipt').textContent,/"simulated": true/);
  assert.equal($('bars').children.length,24);
  ui.edit('max-kw','0.5');
  await $('plan').onclick();
  assert.match($('error').textContent,/circuit power/);
  assert.equal($('approve').disabled,true);assert.equal($('execute').disabled,true);
  $('restore-example').onclick();
  await $('plan').onclick();
  assert.deepEqual(agent.view().scenario,DEMO);
  assert.equal(agent.view().approved,false);
  assert.equal(agent.view().receipt,null);
});

test('session restoration and returned views cannot alter an approved scenario',async()=>{
  const agent=makeAgent();
  const created=agent.offer(custom());
  agent.approve(created.proposal.id);
  const altered=agent.view();
  altered.scenario.maxKw=50;
  altered.proposal.optimized.items[0].start=0;
  altered.history.push({kind:'forged'});
  assert.deepEqual(agent.view().scenario,custom());
  assert.deepEqual(agent.view().proposal.optimized,plan(custom()).optimized);
  const ui=await browserScript(agent);
  assert.equal(ui.$('max-kw').value,'1.5');
  assert.equal(ui.$('ev-topup-enabled').checked,false);
  assert.equal(ui.$('execute').disabled,false);
  agent.cancel();
  const cleared=await browserScript(agent);
  assert.equal(cleared.$('max-kw').value,'1.5');
  assert.equal(cleared.$('execute').disabled,true);
});

test('voice status and cancellation work with an invalid draft; planning still rejects it',async()=>{
  const agent=makeAgent(),created=agent.offer(custom());
  const ui=await browserScript(agent),{$}=ui;
  let validityPrompts=0;
  $('scenario-form').reportValidity=()=>{validityPrompts++;return false;};
  ui.edit('max-kw','');
  $('cmd').value='Explain the plan';
  await $('ask').onclick();
  assert.equal(agent.view().proposal.id,created.proposal.id);
  assert.equal($('max-kw').value,'','read-only reply must not overwrite invalid draft');
  assert.equal($('approve').disabled,true);
  assert.equal(validityPrompts,0,'status must not be blocked by form validation');
  $('cmd').value='Cancel the plan';
  await $('ask').onclick();
  assert.equal(agent.view().status,'empty');
  assert.equal($('output').className,'only-hidden');
  assert.equal(validityPrompts,0,'cancel must not be blocked by form validation');
  $('cmd').value='Plan a cheaper schedule';
  await $('ask').onclick();
  assert.equal(agent.view().status,'empty','invalid scenario must not plan default inputs');
  assert.match($('error').textContent,/Complete all enabled scenario values/);
  assert.equal(validityPrompts,1);
  ui.edit('max-kw','1.5');
  $('scenario-form').reportValidity=()=>true;
  await $('ask').onclick();
  assert.deepEqual(agent.view().scenario,custom(),'valid voice plan uses edited settings');
  assert.equal(agent.view().status,'proposed');
});

