// One source-executed, offline UI regression: late initial GET + all-zero valid tariffs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const element=()=>({textContent:'',className:'',style:{},disabled:false,children:[],
  replaceChildren(){this.children=[]},append(...children){this.children.push(...children)}});
const controls=new Map();
const document={getElementById(id){if(!controls.has(id))controls.set(id,element());return controls.get(id)},
  createElement(){return element()}};
const planned={status:'proposed',approved:false,receipt:null,
  proposal:{id:'synthetic-1',baseline:{cost:2},optimized:{cost:0,items:[]},avoidedCost:2,
    prices:Array(24).fill(0),decisionTrace:{search:'synthetic-only'}}};
let finishInitial;
const initial=new Promise(resolve=>finishInitial=resolve);
const fetch=async(path)=>path==='/api/state'?initial:{ok:true,json:async()=>planned};
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
vm.runInNewContext(source,{document,fetch});
// Simulate a click and a completed POST before the original GET resolves.
await document.getElementById('plan').onclick();
assert.equal(document.getElementById('output').className,'');
assert.match(document.getElementById('status').textContent,/PROPOSED/);
assert.equal(document.getElementById('bars').children.length,24);
assert.ok(document.getElementById('bars').children.every(x=>x.style.height==='0%'),
  'legitimate all-zero hourly tariff must not emit NaN%');
finishInitial({ok:true,json:async()=>({status:'empty',proposal:null})});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(document.getElementById('output').className,'',
  'stale startup GET must not erase newer POST proposal');
assert.match(document.getElementById('status').textContent,/PROPOSED/);
process.stdout.write('PASS: 24 zero-price bars stay finite; late bootstrap response cannot overwrite a completed proposal.\n');
