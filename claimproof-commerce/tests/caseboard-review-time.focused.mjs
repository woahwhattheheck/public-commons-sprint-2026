import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function loadHtml(file) {
  const html=fs.readFileSync(file,'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const script=scripts.at(-1)[1];
  const nodes=new Map();
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,{textContent:'',className:'',disabled:false,value:'',addEventListener(){}});
    return nodes.get(id);
  };
  let options;
  const agGrid={
    themeQuartz:{withPart(){return {};}},
    colorSchemeDark:{},
    createGrid(_el,config){options=config;return {setGridOption(){},forEachNodeAfterFilterAndSort(){}};}
  };
  const context=vm.createContext({window:{agGrid},agGrid,document:{getElementById:get},TextEncoder});
  vm.runInContext(script,context);
  return {context,options};
}

const after=loadHtml(new URL('../src/caseboard.html',import.meta.url));
const date=v=>vm.runInContext('safeDate('+JSON.stringify(v)+')',after.context);
for(const v of ['2026-10-09T12:00:00.123Z','2024-02-29T23:59:59Z','2026-10-09T08:00:00-04:00','2026-10-09T17:30:00+05:30'])assert.equal(date(v),v);
for(const v of ['2026-02-30T12:00:00Z','2026-10-09T12:00:00','2026-13-01T12:00:00Z','2026-10-09T24:00:00Z','2026-10-09T12:00:60Z','2026-10-09T12:00:00+24:00'])assert.throws(()=>date(v));
const comparator=after.options.columnDefs.find(x=>x.field==='time').comparator;
assert.equal(comparator('2026-10-09T08:00:00-04:00','2026-10-09T12:00:00Z'),0);
const times=['2026-10-09T09:00:00-04:00','2026-10-09T12:00:00Z','2026-10-09T13:30:00+02:00'];
assert.deepEqual([...times].sort(comparator),[times[2],times[1],times[0]]);
assert.ok(comparator(times[0],times[1])>0);
console.log('PASS: valid export timestamps retained; six invalid dates rejected; Reviewed comparator orders actual instants and ties equivalent offsets. Real inline source + mocked DOM/AG Grid; no provider, network or rendering.');
