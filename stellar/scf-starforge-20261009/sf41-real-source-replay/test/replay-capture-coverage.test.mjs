// MIT. Protocol edge checks only; not synthetic benchmark outcomes.
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {inspectCaptureCoverage} from '../capture_coverage.mjs';
const origin='https://facilitator.example.net/discovery/resources';
const page=(offset,rows,total=undefined,host=origin)=>{
  const u=new URL(host);u.searchParams.set('offset',String(offset));u.searchParams.set('limit','3');
  return {source:{url:u.href},rows,sha256:offset+':'+rows+':'+host,
    version:2,pagination:total===undefined?{offset,limit:3}:{offset,limit:3,total}};
};
const manifest=(pages,total=null,coverage=undefined)=>({
  schema:'SCF-SF41/capture-v1',endpoint:origin,page_size:3,
  rows_captured:pages.reduce((n,p)=>n+p.rows,0),expected_total:total,
  pagination_coverage:coverage,sources:pages.map(p=>p.source)
});
test('declared total proves full offset coverage including short first page',()=>{
  const pages=[page(0,2,4),page(2,2,4)],m=manifest(pages,4,'DECLARED_TOTAL_MATCHED');
  const v=inspectCaptureCoverage(m,pages);assert.equal(v.verified,true);assert.equal(v.rows,4);
  assert.equal(v.status,'DECLARED_TOTAL_MATCHED');
});
test('historical partial manifest cannot masquerade as complete',()=>{
  const pages=[page(0,2,4)],m=manifest(pages,4);
  assert.throws(()=>inspectCaptureCoverage(m,pages),/incomplete corpus/);
});
test('offset discontinuity and unstable totals fail',()=>{
  const bad=[page(0,2,4),page(3,2,4)];
  assert.throws(()=>inspectCaptureCoverage(manifest(bad,4),bad),/noncontiguous/);
  const drift=[page(0,2,4),page(2,2,5)];
  assert.throws(()=>inspectCaptureCoverage(manifest(drift,4),drift),/total changed/);
});
test('without total only explicit empty page proves completion',()=>{
  const pages=[page(0,2),page(2,0)];
  const v=inspectCaptureCoverage(manifest(pages,null,'EXPLICIT_EMPTY_PAGE'),pages);
  assert.equal(v.status,'EXPLICIT_EMPTY_PAGE');
  assert.throws(()=>inspectCaptureCoverage(manifest(pages.slice(0,1)),pages.slice(0,1)),/no declared total/);
});
test('contradictory manifest row count and coverage labels fail closed',()=>{
  const p=[page(0,2,2)],m=manifest(p,2,'EXPLICIT_EMPTY_PAGE');
  assert.throws(()=>inspectCaptureCoverage(m,p),/coverage label/);
  const n=manifest(p,2,'DECLARED_TOTAL_MATCHED');n.rows_captured=1;
  assert.throws(()=>inspectCaptureCoverage(n,p),/rows_captured/);
});
test('mixed provider manifests are reported unverified, not mislabeled complete',()=>{
  const a=page(0,1,1),b=page(0,1,1,'https://another.example.net/discovery/resources');
  const p=[a,b],m=manifest(p,2);
  const v=inspectCaptureCoverage(m,p);assert.equal(v.verified,false);assert.equal(v.status,'MIXED_PROVIDERS');
});
