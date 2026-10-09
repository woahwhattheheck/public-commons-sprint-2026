import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandidates, normalizeInsights, audit } from '../src/audit.mjs';

test('malformed popularity, null objects and duplicate Qloo entity evidence fail closed', async () => {
  const cases = [
    [true,null],[false,null],[[],null],[{},null],['',null],[' ',null],
    ['0x1',null],['0b1',null],['Infinity',null],['NaN',null],['1e309',null],
    [0,0],[1,1],[.5,.5],['0.25',.25],[' 0.75 ',.75],['1e-1',.1],
    [-.01,null],[1.01,null]
  ];
  for(const [v,expected] of cases)
    assert.equal(normalizeInsights({results:{entities:[{id:'x',name:'X',popularity:v}]}})[0].popularity, expected);
  const mixed={results:{entities:[
    null,false,[],{}, {entity_id:'x',name:'Alpha',popularity:true},
    {entity_id:'x',name:'Duplicate',popularity:1},
    {entity_id:'y',name:'Bravo',popularity:' '},
    {entity_id:'z',name:'Charlie',popularity:[]},
    {entity_id:'w',name:'Delta',popularity:'0.75'},
    {entity_id:'t',name:'Echo',popularity:0},
  ]}};
  assert.deepEqual(normalizeInsights(mixed).map(x=>[x.id,x.popularity]),
    [['x',null],['y',null],['z',null],['w',.75],['t',0]]);
  assert.deepEqual(normalizeCandidates({results:[
    null,[],false,{id:'x',name:'A'},{id:'x',name:'Duplicate'},
    {id:'y',name:'B'}
  ]}).map(x=>x.id),['x','y']);
  assert.throws(()=>normalizeInsights({}),/entities/);
  const provider={
    async search(){return {results:{entities:[null,{id:'x',name:'Seed'}]}};},
    async insights(){return mixed;}
  };
  const report=await audit({seed:'Seed',seedType:'urn:entity:movie',
    target:'urn:entity:movie'},provider);
  assert.equal(report.status,'complete');
  assert.equal(report.metrics.baselineCount,5);
  assert.equal(report.metrics.reportedPopularity,2);
  assert.equal(report.metrics.medianPopularity,.375);
  assert.equal(report.segments.low.count,5);
  assert.equal(report.segments.high.count,5);
});
test('4096 deterministic adversarial arrays preserve stable first-ID membership',()=>{
  let seed=20261009;
  const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  for(let trial=0;trial<4096;trial++){
    const entities=[],seen=new Set(),expected=[];
    for(let j=0,n=3+Math.floor(rand()*30);j<n;j++){
      if(Math.floor(rand()*17)<2){entities.push(null);continue;}
      const id=String(Math.floor(rand()*11));
      entities.push({id,name:'Entity'+id,popularity:
        [true,[],{},' ',0,.5,.25,'0.75','1e309'][Math.floor(rand()*9)]});
      if(!seen.has(id)){seen.add(id);expected.push(id);}
    }
    const rows=normalizeInsights({results:{entities}});
    assert.deepEqual(rows.map(x=>x.id),expected);
    assert.ok(rows.every(x=>x.popularity===null ||
      (typeof x.popularity==='number' && Number.isFinite(x.popularity)
        && x.popularity>=0 && x.popularity<=1)));
  }
});
