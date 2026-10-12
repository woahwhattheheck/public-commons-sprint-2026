// MIT. One complete receiving journey through the original generated client, Buyer and response writer.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClientRuntime} from '../../developer/client-runtime.mjs';
import {X402BuyerClient} from '../../../sf31-buyer-client/buyer.mjs';
import {prepareBuyerResponseFile} from '../../../sf31-buyer-client/response-file.mjs';
import {runCustomerExport,inspectCustomerExport} from './customer-export.mjs';

const sourceRoot=fileURLToPath(new URL('.',import.meta.url));
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--out'||!args[1]||args[1].startsWith('--'))
 throw new TypeError('Use node customer-export-journey.mjs --out NEW_PRIVATE_RECEIVING_DIRECTORY');
const root=resolve(args[1]);
await fs.mkdir(root,{mode:0o700});
const digest=data=>createHash('sha256').update(data).digest('hex');
const sample=JSON.parse(await fs.readFile(join(sourceRoot,'customer-export.plan.example.json'),'utf8'));
const products=[
{id:'AvailabilityRead-v2',query:'availability',kind:'get',input:{}},
{id:'CatalogRead-v2',query:'catalog',kind:'hash',input:{region:'north'}},
{id:'LeaderboardRead-v2',query:'leaderboard',kind:'sorted-set',input:{offset:'0'}},
{id:'EventsRead-v2',query:'events',kind:'stream',input:{after:'-'}},
{id:'ListRead-v2',query:'list_feed',kind:'list',input:{offset:'0'}},
{id:'CustomerMembers-v2',query:'CustomerMembers',kind:'set',cursorParameter:'scan_token',input:{scan_token:'0',region:'north'}}
].map(p=>({...p,maxAtomic:'10000',acceptIndex:0,paymentFlow:'authorization'}));
const base={schema:'stellar-forge.seller-client.v1',mode:'fixture',title:'Original customer export contract receiving',
origin:'https://receiving.example.test',operations:products.map((p,i)=>({
id:p.id,method:'GET',path:'/data/'+i,pathNames:[],requiredQuery:Object.keys(p.input),
offer:{x402Version:2,resource:{url:'https://receiving.example.test/data/'+i,mimeType:'application/json'},
accepts:[{scheme:'exact',network:'stellar:testnet',asset:'native',amount:'10000',
payTo:'fixture-merchant',maxTimeoutSeconds:60}]}
}))};
const generated=createClientRuntime({...base,sourceSha256:digest(JSON.stringify(base))});
const clientManifest={sourceSha256:generated.source.sourceSha256,filesSha256:digest('original runtime fixture source')};
const binary=Buffer.alloc(49152);for(let i=0;i<binary.length;i++)binary[i]=i%251;
const large=binary.toString('base64');
const requests=[],returned=[];
const fetchImpl=async(url,options)=>{
 const u=new URL(String(url)),index=Number(u.pathname.split('/').at(-1)),p=products[index];
 assert.equal(options.method,'GET');assert.equal(new Headers(options.headers).has('payment-signature'),false);
 const input=Object.fromEntries(u.searchParams),rows=[];let nextInput,extra={};
 if(p.kind==='get')rows.push({value:'9007199254740993'});
 if(p.kind==='hash')rows.push({region:input.region,bytesBase64:large});
 if(p.kind==='sorted-set'){rows.push({member:input.offset==='0'?'A':'B',score:'9007199254740993'});if(input.offset==='0')nextInput={offset:'1'};}
 if(p.kind==='stream'){rows.push({id:input.after==='-'?'9007199254740993-0':'9007199254740993-1',value:'retained'});if(input.after==='-')nextInput={after:'9007199254740993-0'};}
 if(p.kind==='list'){rows.push({offset:input.offset,value:input.offset==='0'?large:'tail'});if(input.offset==='0')nextInput={offset:'1'};}
 if(p.kind==='set'){
   const cursor=input.scan_token;if(cursor==='16')rows.push({member:'A'},{member:'A'});
   if(cursor==='8')rows.push({member:'B'},{member:'A'});
   const next=cursor==='0'?'16':cursor==='16'?'8':'0';
   extra={scanCursor:next,scanComplete:next==='0',iterationConsistency:'native-sscan',duplicatesPossible:true};
   if(next!=='0')nextInput={scan_token:next,region:input.region};
 }
 const value={schema:'stellar-forge.redis-result.v1',query:p.query,kind:p.kind,columns:Object.keys(rows[0]??{member:''}),
 rows,rowCount:rows.length,truncated:!!nextInput,...(nextInput?{nextInput}:{}),...extra};
 const body=JSON.stringify(value)+'\n';requests.push({id:p.id,input,url:u.href});returned.push(body);
 return new Response(body,{status:200,headers:{'content-type':'application/json; charset=utf-8','x-request-id':'fixture-'+requests.length}});
};
const originalBuyer=new X402BuyerClient({fetchImpl});
const callbacks={approve:async()=>{throw Error('Unsigned fixture must not approve payment');},sign:async()=>{throw Error('Unsigned fixture must not sign');}};
const plan={...sample,operationId:'full-original-client-receiving',products};
const directory=join(root,'full-output');
const result=await runCustomerExport({generated,clientManifest,buyer:originalBuyer,...callbacks,prepareBuyerResponseFile,plan,directory});
assert.equal(result.status,'COMPLETE');assert.equal(result.calls.length,11);
assert.deepEqual(requests.slice(0,6).map(r=>r.id),products.map(p=>p.id));
assert.deepEqual(requests.filter(r=>r.id==='CustomerMembers-v2').map(r=>r.input.scan_token),['0','16','8']);
assert.equal(result.products.find(p=>p.id==='CustomerMembers-v2').rows,4);
assert.equal(result.calls.find(c=>c.product==='CustomerMembers-v2').data.rowCount,0);
for(let i=0;i<result.calls.length;i++){
 const call=result.calls[i],raw=await fs.readFile(join(directory,call.file.name));
 assert.equal(raw.toString('utf8'),returned[i]);assert.equal(digest(raw),call.file.sha256);
 assert.equal(raw.length,call.file.bytes);assert.equal(call.result.responseRequestIds['x-request-id'],'fixture-'+(i+1));
 assert.equal(call.result.intentId,call.intentId);
}
assert(result.calls.some(c=>c.file.bytes>65000));
const reopened=await inspectCustomerExport({directory});assert.deepEqual(reopened.calls,result.calls);
const originalCount=requests.length;
await assert.rejects(runCustomerExport({generated,clientManifest,buyer:originalBuyer,...callbacks,prepareBuyerResponseFile,plan,directory}),{code:'EEXIST'});
assert.equal(requests.length,originalCount);
const budgetPlan={...plan,operationId:'budget-receiving',budget:{maxCalls:2,maxAtomic:'600000'}};
const budgetResult=await runCustomerExport({generated,clientManifest,buyer:originalBuyer,...callbacks,prepareBuyerResponseFile,
 plan:budgetPlan,directory:join(root,'budget-output')});
assert.equal(budgetResult.status,'CALL_BUDGET_REACHED');assert.equal(budgetResult.calls.length,2);
assert.equal((await inspectCustomerExport({directory:join(root,'budget-output')})).status,'CALL_BUDGET_REACHED');
const mismatchPlan={...plan,operationId:'returned-metadata-receiving',products:[products[0]]};
let mismatch;
try{await runCustomerExport({generated,clientManifest,buyer:{call:async request=>({...await originalBuyer.call(request),intentId:'original-native-mismatch'})},
 ...callbacks,prepareBuyerResponseFile,plan:mismatchPlan,directory:join(root,'mismatch-output')});}
catch(error){mismatch=error;}
assert.equal(mismatch?.code,'CUSTOMER_EXPORT_IDENTITY');
const retained=await inspectCustomerExport({directory:join(root,'mismatch-output')});
assert.equal(retained.status,'REVIEW');assert.equal(retained.calls.length,1);
assert.equal(retained.calls[0].phase,'SAVED_RESPONSE_REVIEW');assert(retained.calls[0].file);
assert.equal(retained.calls[0].result.intentId,'original-native-mismatch');
const identities={};
for(const path of ['customer-export.mjs','../../developer/client-runtime.mjs','../../developer/request.mjs','../../query-parameters.mjs',
 '../../../sf31-buyer-client/buyer.mjs','../../../sf31-buyer-client/request-body.mjs','../../../sf31-buyer-client/response-file.mjs','../../../sf31-buyer-client/response-stream.mjs'])
 identities[path]=digest(await fs.readFile(resolve(sourceRoot,path)));
console.log(JSON.stringify({status:'PASS',fixture:true,node:process.version,at:new Date().toISOString(),directory:root,
complete:{calls:result.calls.length,products:result.products.map(({id,pages,rows,status})=>({id,pages,rows,status})),
maxResponseBytes:Math.max(...result.calls.map(c=>c.file.bytes)),reopened:true,repeatBuyerCalls:0},
budget:{status:budgetResult.status,calls:budgetResult.calls.length},
mismatch:{status:retained.status,phase:retained.calls[0].phase,retainedBytes:retained.calls[0].file.bytes},
providerRequests:0,sourceSha256:identities}));
