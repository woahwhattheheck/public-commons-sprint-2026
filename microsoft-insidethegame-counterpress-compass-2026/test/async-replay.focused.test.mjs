import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Network delays are controlled: exercise the actual browser app without a browser service.
test('latest replay response wins, including a superseded Foundry draft', async () => {
  const listeners = new Map();
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: ({team:'Harbor FC',audience:'casual',locale:'en'}[id] || ''),
      textContent:'', style:{}, children:[],
      addEventListener(type, fn) { listeners.set(id+':'+type,fn); },
      replaceChildren() { this.children=[]; },
      append(...parts) { this.children.push(...parts); }
    });
    return elements.get(id);
  };
  const events = [
    {id:'e001',second:10,team:'Harbor FC',type:'loss',zone:'middle',player:'H1'},
    {id:'e002',second:12,team:'Harbor FC',type:'regain',zone:'middle',player:'H2'},
  ];
  const analyze=[];
  const draft=[];
  const fetch = async (url, request) => {
    if (url === '/api/bootstrap') return {ok:true,json:async()=>({events,foundryConfigured:true})};
    return new Promise((resolve,reject) => {
      const job = {body:JSON.parse(request.body),resolve(value){resolve({ok:true,json:async()=>value});},reject};
      (url === '/api/analyze' ? analyze : draft).push(job);
    });
  };
  const document = {getElementById:get,createElement:()=>({textContent:'',append(){}})};
  const original = await readFile(new URL('../web/app.js', import.meta.url),'utf8');
  vm.runInNewContext(original,{document,fetch,setInterval:()=>1,clearInterval:()=>{}}, {filename:'app.js'});
  // Boot's async bootstrap and initial replay must complete before invoking controls.
  for(let i=0;i<8 && analyze.length===0;i++) await Promise.resolve();
  assert.equal(analyze.length,1);
  analyze[0].resolve(snapshot('initial',0));
  for(let i=0;i<8 && !listeners.has('next:click');i++) await Promise.resolve();
  listeners.get('next:click')();
  listeners.get('next:click')();
  assert.equal(analyze.length,3);
  assert.equal(analyze[2].body.count,2);
  analyze[2].resolve(snapshot('newest',12));
  for(let i=0;i<8;i++) await Promise.resolve();
  assert.equal(get('overlay').textContent,'newest');
  analyze[1].resolve(snapshot('stale',10));
  for(let i=0;i<8;i++) await Promise.resolve();
  assert.equal(get('overlay').textContent,'newest');
  assert.match(get('frame').textContent,/2\/2/);
  listeners.get('foundry:click')();
  assert.equal(draft.length,1);
  listeners.get('reset:click')();
  analyze[3].resolve(snapshot('reset',0));
  for(let i=0;i<8;i++) await Promise.resolve();
  draft[0].resolve({label:'STALE',text:'wrong frame'});
  for(let i=0;i<8;i++) await Promise.resolve();
  assert.equal(get('foundryResult').textContent,'');
  assert.equal(get('overlay').textContent,'reset');
});

function snapshot(text,elapsedSeconds){
  return {elapsedSeconds,stats:{counterpressAttempts:1,successes:1,meanRecoverySeconds:2,successRatePct:100,resolvedCounterpressAttempts:1,interruptedAttempts:0},overlays:[{showAt:0,hideAt:20,text,evidenceIds:['e001','e002'],provenance:'SYNTHETIC'}]};
}
