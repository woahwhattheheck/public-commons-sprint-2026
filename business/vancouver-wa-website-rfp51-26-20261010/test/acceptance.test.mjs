import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {buildPlan,inspectTarget} from '../acceptance.mjs';
const manifest=JSON.parse(await readFile(new URL('../baseline.json',import.meta.url),'utf8'));
test('five real buyer paths, preserved offsite hrefs and safe read-only observations',async()=>{
 const hits=[];const server=createServer((req,res)=>{
   hits.push({method:req.method,url:req.url});
   if(req.url==='/government/calendar/'){res.writeHead(302,{location:'/governance/calendar/'}).end();return;}
   res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="en"><main><h1>Vancouver</h1><a href="https://cityofvancouver.selectpaytoday.com/Utility/">Pay utilities</a><a href="https://www.bidnetdirect.com/washington/cityofvancouver">SOVRA</a></main></html>');
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
   const plan=buildPlan(manifest);assert.equal(plan.sampledPages.length,5);
   const base=`http://127.0.0.1:${server.address().port}/`;
   const report=await inspectTarget(manifest,{targetBase:base});
   assert.equal(report.pageCount,5);assert.equal(hits.length,5);
   assert.ok(hits.every(x=>x.method==='GET'));
   assert.equal(report.pages.find(x=>x.pageId==='calendar').error,'REDIRECT_REQUIRES_REVIEW');
   assert.equal(report.pages.find(x=>x.pageId==='home').originalOutboundChecks.find(x=>x.id==='utilities').evidence,'LINK_PRESENT');
   assert.equal(report.pages.find(x=>x.pageId==='procurement').originalOutboundChecks.find(x=>x.id==='procurement-portal').evidence,'LINK_PRESENT');
   assert.equal(report.pages.find(x=>x.pageId==='home').originalOutboundChecks.find(x=>x.id==='parking').evidence,'NEEDS_OWNER_REVIEW');
   assert.equal(report.overall,'REVIEW_REQUIRED');
   await assert.rejects(inspectTarget({...manifest,pages:manifest.pages.map((x,i)=>i?x:{...x,path:'//evil.tld/'})},{targetBase:base}),/Unsafe/);
 } finally {server.close();await once(server,'close');}
});
