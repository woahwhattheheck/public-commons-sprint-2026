// MIT. Focused wire/pagination/size checks; these are not original provider simulation results.
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {checkNativePage,readBoundedPage} from '../capture.mjs';
const body=(items,offset,total)=>({x402Version:2,items,pagination:{limit:3,offset,total}});
const args=(offset,expectedTotal=null)=>({offset,pageLimit:3,expectedTotal});
test('real v2 offset contract: short nonfinal pages do not truncate declared total',()=>{
  const p1=checkNativePage(body(['a','b'],0,4),args(0));
  assert.equal(p1.complete,false);
  const p2=checkNativePage(body(['c','d'],2,4),args(p1.nextOffset,p1.total));
  assert.equal(p2.complete,true);assert.equal(p2.nextOffset,4);
});
test('source count mismatch or early empty page fails closed',()=>{
  assert.throws(()=>checkNativePage(body([],2,4),args(2,4)),/truncated/);
  assert.throws(()=>checkNativePage(body(['a','b','c'],2,4),args(2,4)),/exceed/);
  assert.throws(()=>checkNativePage(body(['a'],0,5),args(2)),/offset mismatch/);
  assert.throws(()=>checkNativePage(body(['a'],0,5),args(0,4)),/total changed/);
});
test('without native total, a short page is NOT EOF, explicit empty page is',()=>{
  const p=checkNativePage({items:['a']},args(0));assert.equal(p.complete,false);
  const terminal=checkNativePage({items:[]},args(1,p.total));
  assert.equal(terminal.complete,true);assert.equal(terminal.coverage,'EXPLICIT_EMPTY_PAGE');
});
test('v2 native schema and finite paging values required',()=>{
  assert.throws(()=>checkNativePage({x402Version:1,items:[]},args(0)),/Non-v2/);
  assert.throws(()=>checkNativePage({items:['a'],pagination:{offset:-1}},args(0)),/Malformed/);
  assert.throws(()=>checkNativePage({items:['a','b','c','d']},args(0)),/exceeds requested limit/);
});
test('GET response byte limit enforced while streaming',async()=>{
  const normal=await readBoundedPage(new Response('abc'),3);
  assert.equal(normal.toString(),'abc');
  await assert.rejects(readBoundedPage(new Response('abcd'),3),/exceeds byte limit/);
});
