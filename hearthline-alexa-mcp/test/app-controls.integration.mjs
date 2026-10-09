import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/store.mjs';
import { HearthlineOrchestrator } from '../src/orchestrator.mjs';
import { dispatchMcpMethod } from '../src/mcp-server.mjs';
import { dashboardHtml } from '../src/app-resource.mjs';

class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.handlers={};this.textContent='';this.disabled=false;this.hidden=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 addEventListener(name,handler){this.handlers[name]=handler;}
}
const source=dashboardHtml().match(/<script>([\s\S]*)<\/script>/)[1];
const results=[]; const trace=[];
async function setup(mode='live') {
 const store=new JsonStore(join(await mkdtemp(join(tmpdir(),'hearthline-control-')),'state.json'));await store.load();
 const runtime=new HearthlineOrchestrator({store,alertProvider:async()=>[{id:'synthetic-local-fixture',severity:'Severe',headline:'Demo only: storm alert'}]});
 await runtime.seedInventory({flashlight:1,water:1,battery_pack:0,first_aid_kit:1});
 const mission=await runtime.prepareStormMission({title:'Household mission',latitude:38.2,longitude:-85.7});
 const nodes=Object.fromEntries(['root','status','connection','notice','refresh','receipt-box','receipt'].map(id=>[id,new Element()]));
 const timers=new Map();let nextTimer=0;let receive;let injected=false;const calls=[];const session={toolCalls:[]};
 const parent={postMessage(msg){
  if(msg.method==='ui/initialize')queueMicrotask(()=>send({id:msg.id,result:{protocolVersion:'2026-01-26',hostCapabilities:mode==='readonly'?{}:{serverTools:{}}}}));
  else if(msg.method==='ui/notifications/initialized')queueMicrotask(()=>send({method:'ui/notifications/tool-result',params:{structuredContent:{mission}}}));
  else if(msg.method==='tools/call'){
   const saved=JSON.parse(JSON.stringify(msg));calls.push(saved);
   if(mode==='refusal'&&!injected&&msg.params.name==='hearthline_approve_action'){injected=true;queueMicrotask(()=>send({id:msg.id,error:{code:-32004,message:'Host refused approval'}}));return;}
   dispatchMcpMethod('tools/call',JSON.parse(JSON.stringify(msg.params)),runtime,session).then(result=>{
    trace.push({mode,request:saved,result});
    if(mode==='lostreply'&&!injected&&msg.params.name==='hearthline_approve_action'){injected=true;return;}
    send({id:msg.id,result});
   });
  }
 }};
 const send=body=>receive({source:parent,origin:'https://test-host.invalid',data:{jsonrpc:'2.0',...body}});
 vm.runInNewContext(source,{document:{getElementById:id=>nodes[id],createElement:tag=>new Element(tag)},window:{parent,addEventListener:(name,fn)=>{receive=fn;}},setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),crypto:{randomUUID:()=>mode+'-fixed-instance'}});
 const flatten=node=>[node,...node.children.flatMap(flatten)];
 const button=(label)=>flatten(nodes.root).find(node=>node.tagName==='button'&&node.textContent===label);
 const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,3));};
 await settle();
 const click=async label=>{const target=label==='Refresh mission'?nodes.refresh:button(label);assert.ok(target,label+' exists');assert.equal(target.disabled,false,label+' enabled');target.handlers.click();await settle();};
 return {store,runtime,mission,nodes,timers,calls,button,click,settle,send};
}
{
 const h=await setup();assert.equal(h.calls.length,0,'no automatic mutation');
 await h.click('Approve local handoff');assert.equal(h.store.snapshot().receipts.length,0,'approval does not execute');
 await h.click('Execute approved local action');const digest=h.store.snapshot().receipts[0].receiptDigest;
 await h.click('Replay original receipt');assert.equal(h.store.snapshot().receipts.length,1);assert.equal(JSON.parse(h.nodes.receipt.textContent).receiptDigest,digest);assert.equal(JSON.parse(h.nodes.receipt.textContent).replayed,true);
 await h.click('Approve local reminder');await h.click('Execute approved local action');
 const state=h.store.snapshot();assert.equal(state.outbox.length,1);assert.equal(state.missions[h.mission.id].status,'complete');
 assert.equal(state.receipts[0].semantics,'prepared_not_purchased');assert.equal(state.receipts.length,2);
 results.push({scenario:'production UI script → real dispatcher → durable store; approve, execute, replay, complete both actions',pass:true,tool_calls:h.calls.length,receipts:2,outbox:1});
}
{
 const h=await setup('readonly');assert.equal(h.button('Approve local handoff').disabled,true);assert.equal(h.calls.length,0);results.push({scenario:'capability-absent host remains view only',pass:true});
}
{
 const h=await setup('refusal');await h.click('Approve local handoff');assert.match(h.nodes.notice.textContent,/Host refused/);assert.equal(h.button('Approve local handoff').disabled,true);assert.equal(Object.keys(h.store.snapshot().authority.operations).length,0);await h.click('Refresh mission');assert.equal(h.button('Approve local handoff').disabled,false);results.push({scenario:'host refusal leaves no approval and requires successful read to restore controls',pass:true});
}
{
 const h=await setup('lostreply');await h.click('Approve local handoff');assert.equal(Object.keys(h.store.snapshot().authority.operations).length,1);
 const timeout=[...h.timers.values()].find(t=>t.ms===30000);assert.ok(timeout);timeout.fn();await h.settle();assert.match(h.nodes.notice.textContent,/outcome is unknown/);assert.equal(h.button('Approve local handoff').disabled,true);
 await h.click('Refresh mission');assert.ok(h.button('Execute approved local action'));await h.click('Execute approved local action');assert.equal(h.store.snapshot().receipts.length,1);assert.equal(Object.keys(h.store.snapshot().authority.operations).length,1);results.push({scenario:'committed approval with dropped response recovers existing operation after timeout and explicit refresh',pass:true});
}
const evidenceDir = process.env.HEARTHLINE_APP_EVIDENCE_DIR;
if (evidenceDir) { await mkdir(evidenceDir, { recursive: true }); await writeFile(join(evidenceDir, 'native-app-control-trace.json'), JSON.stringify(trace, null, 2) + '\n'); }
const receipt={status:'PASS',runtime:process.version,method:'production embedded UI script evaluated in Node VM with minimal DOM; actual existing tool dispatcher/orchestrator/JsonStore (no network bridge mock for server effects)',scenarios:results,limitations:['real Chromium navigation blocked by administrator policy','not an HTTP-browser integration proof','weather and host fault injections are explicit local fixtures','no Alexa host, AWS effects, contest submission or award']};
if (evidenceDir) await writeFile(join(evidenceDir, 'native-app-acceptance.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt,null,2));
