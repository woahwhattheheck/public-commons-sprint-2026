// MIT. One signed-event -> durable buyer -> export lifecycle on the original modules.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHmac, createHash } from 'node:crypto';
import { createSubscription, openSubscription } from './subscriber.mjs';
const sellerUrl = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) :
  new URL('../../sf30-seller-sdk/webhook-feed/store.mjs', import.meta.url);
const {EventFeedStore} = await import(sellerUrl.href);
const root = await mkdtemp(join(process.argv[3] ?? tmpdir(), 'starforge-event-feed-'));
const now = Date.parse('2026-10-11T22:00:00Z');
const key = Buffer.alloc(32, 17), secret = 'whsec_' + key.toString('base64');
const seller = new EventFeedStore(join(root,'seller'), {now:()=>now,secretResolver:()=>secret});
const source = {id:'inventory',label:'Inventory',secretEnv:'EVENTS_WEBHOOK_SECRET',
  typePointer:'/type',occurredAtPointer:'/timestamp',maxEventBytes:65536,enabled:true};
const feed = {id:'stock',label:'Stock changes',description:'Reviewed inventory changes',
  sourceIds:['inventory'],types:['inventory.changed'],defaultPageSize:2,maxPageSize:100,
  maxPageBytes:1048576,enabled:true,projection:[
    {name:'sku',pointer:'/data/sku'},{name:'quantity',pointer:'/data/quantity'},
    {name:'externalId',pointer:'/data/externalId'}]};
let buyer, competing, retainedBuyer, complete = false;
const hash = bytes=>createHash('sha256').update(bytes).digest('hex');
const body = (sku,type='inventory.changed')=>Buffer.from(JSON.stringify({
  type,timestamp:new Date(now).toISOString(),privateCustomer:'excluded',
  data:{sku,quantity:2,externalId:'INTEGER_LITERAL'}
}).replace('"INTEGER_LITERAL"','9007199254740993'));
const submit = (id,raw)=>{
  const stamp=String(now/1000);
  const signature=createHmac('sha256',key).update(id+'.'+stamp+'.').update(raw).digest('base64');
  return seller.acceptWebhook('inventory',{'webhook-id':id,'webhook-timestamp':stamp,
    'webhook-signature':'v1,'+signature},raw);
};
const response = page=>({bytes:Buffer.from(JSON.stringify(page)),nativeStatus:'COMPONENT_DELIVERY',
  httpStatus:200,recovered:false});
try {
  seller.saveDefinition('source',source);
  seller.saveDefinition('feed',feed);
  const revision=seller.definition('feed','stock').revision;
  const original=body('A');
  assert.equal(submit('event-1',original).sequence,1);
  assert.equal(submit('event-1',original).duplicate,true);
  assert.throws(()=>submit('event-1',body('changed')),error=>error.code==='EVENT_ID_CONFLICT');
  submit('event-2',body('B'));submit('event-3',body('ignored','inventory.unchanged'));
  submit('event-4',body('C'));
  const first=seller.readPage('stock',{limit:2});
  assert.equal(first.feedRevision,revision);
  assert.deepEqual(first.items.map(item=>item.sequence),[1,2]);
  assert.equal(first.items[0].payload.externalId,'9007199254740993');
  assert.equal(first.items[0].sourceBodySha256,hash(original));
  assert.equal(Object.hasOwn(first.items[0].payload,'privateCustomer'),false);
  assert.equal(first.page.throughSequence,4);
  submit('event-5',body('D'));
  buyer=await createSubscription({directory:join(root,'buyer'),id:'stock',feedId:'stock',pageSize:2,
    runtimeDirectory:resolve(root,'original-runtime'),buyerStateDirectory:join(root,'original-buyer'),
    config:{operation:{method:'GET',url:'https://merchant.example/feeds/stock'}}});
  const firstPlan=buyer.plan();
  competing=await openSubscription(join(root,'buyer'));
  assert.equal(competing.plan().operation_id,firstPlan.operation_id);
  buyer.accept(firstPlan,response(first));
  assert.equal(buyer.accept(firstPlan,response(first)).replay,true);
  const secondPlan=buyer.plan();
  buyer.close();buyer=await openSubscription(join(root,'buyer'));
  assert.equal(buyer.pending().operation_id,secondPlan.operation_id);
  const second=seller.readPage('stock',{cursor:first.page.nextCursor,limit:2});
  assert.equal(second.page.throughSequence,4);
  assert.deepEqual(second.items.map(item=>item.sequence),[4]);
  const corrupt=JSON.parse(JSON.stringify(second));corrupt.items[0].payload.quantity=99;
  assert.throws(()=>buyer.accept(secondPlan,response(corrupt)),error=>error.code==='FEED_EVENT_INVALID');
  assert.equal(buyer.inspect().events,2);assert.equal(buyer.checkpoint().last_sequence,2);
  buyer.accept(secondPlan,response(second));
  assert.equal(buyer.checkpoint().last_sequence,4);
  assert.equal(competing.plan({cycle:firstPlan.cycle}),null);
  competing.close();competing=null;
  const destination=join(root,'first.ndjson'),exported=await buyer.exportEvents(destination);
  assert.equal(exported.events,3);
  const bytes=await readFile(destination);
  assert.equal(hash(bytes),exported.data.sha256);
  const next=seller.readPage('stock',{cursor:second.page.resumeCursor,limit:2});
  assert.deepEqual(next.items.map(item=>item.sequence),[5]);
  buyer.accept(buyer.plan(),response(next));
  assert.equal(buyer.inspect().events,4);
  const replayExport=await buyer.exportEvents(destination);
  assert.equal(replayExport.data.sha256,exported.data.sha256);
  assert.equal(replayExport.events,3);
  assert.equal((await buyer.exportEvents(join(root,'latest.ndjson'))).events,4);
  seller.purge(2,5);
  const retained=seller.readPage('stock',{limit:2});
  assert.equal(retained.page.afterSequence,2);
  retainedBuyer=await createSubscription({directory:join(root,'retained-buyer'),id:'retained',feedId:'stock',pageSize:2,
    runtimeDirectory:resolve(root,'original-runtime'),buyerStateDirectory:join(root,'retained-original-buyer'),
    config:{operation:{method:'GET',url:'https://merchant.example/feeds/stock'}}});
  retainedBuyer.accept(retainedBuyer.plan(),response(retained));
  assert.equal(retainedBuyer.inspect().originSequence,2);
  assert.equal(retainedBuyer.inspect().events,2);
  retainedBuyer.close();retainedBuyer=null;
  const impossible=seller.encodeCursor(seller.definition('feed','stock'),5,999);
  assert.throws(()=>seller.readPage('stock',{cursor:impossible}),error=>error.code==='INVALID_CURSOR');
  seller.saveDefinition('source',{...source,typePointer:'/eventType'},
    seller.definition('source','inventory').revision);
  assert.notEqual(seller.definition('feed','stock').revision,revision);
  assert.throws(()=>seller.readPage('stock',{cursor:next.page.resumeCursor}),error=>error.code==='FEED_CHANGED');
  complete=true;
  console.log(JSON.stringify({state:'PASSED',node:process.version,signedEvents:5,
    duplicateDeliveries:1,receivedEvents:4,pages:3,initialExportEvents:3,latestExportEvents:4,
    originalResponseBytesRetained:true,fixedWindow:4,unsafeIntegerPreserved:true,
    sourceRevisionInvalidatesCursor:true,retainedOrigin:2,completedCycleDidNotReserveAnotherPage:true,
    exportSha256:exported.data.sha256}));
} finally {
  buyer?.close();competing?.close();retainedBuyer?.close();seller.close();
  if(complete)await rm(root,{recursive:true});
  else console.error('Retained journey state: '+root);
}
