#!/usr/bin/env node
/** MIT. Complete original governed buyer → expense → accountant → receiving operation.
 * Controlled development inputs use the original quote store, binding derivation,
 * SF36 helper and finality verifier. Every expense mutation uses the maintained
 * MerchantBuyerExpenses → original HTTP/SQLite request and revision contract.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,realpath} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {MerchantBuyerExpenses,readBuyerExpenseConfiguration,BUYER_EXPENSE_CONNECTION_SCHEMA} from './buyer-expenses.mjs';
import {SqliteQuoteStore} from '../mcp-paid-agent/quote-store.mjs';
import {prepareMcpInvocation} from '../mcp-paid-agent/remote-mcp.mjs';
import {mcpSpendingBinding} from '../mcp-paid-agent/native-spend-binding.mjs';
import {inspectSavedMcpPayment} from '../mcp-paid-agent/expense-statement.mjs';
import {networkProfile} from '../../stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/terms.mjs';
import {createHandoff,renderCsv,parseReturnCsv,accountantColumns,importReturn,inspectHandoff} from
  '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/engine.mjs';
import {createBuyerReturnPacket} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/buyer-return.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const APP=join(ROOT,'stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace');
const HELPER=join(ROOT,'stellar-forge/mcp-paid-agent/native-spend-governor.py');
const OPERATION='governed-buyer-expense-receiving-f232-20261012';
const KEYS=['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const PREFIX='merchant_buyer_expense_';

async function privateWrite(path,value){
  const bytes=Buffer.isBuffer(value)?value:typeof value==='string'?Buffer.from(value):json(value);
  await writeFile(path,bytes,{mode:0o600,flag:'wx'});return {path,bytes:bytes.length,sha256:hash(bytes)};
}
function run(command,args,{environment=process.env,input,timeout=120000}={}){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{env:environment,stdio:['pipe','pipe','pipe'],shell:false});
    const out=[],err=[];let size=0;const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);
    child.stdout.on('data',bytes=>{size+=bytes.length;if(size>96*1024*1024)child.kill('SIGTERM');else out.push(bytes);});
    child.stderr.on('data',bytes=>{if(err.reduce((n,b)=>n+b.length,0)<1024*1024)err.push(bytes);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',(code,signal)=>{clearTimeout(timer);const stdout=Buffer.concat(out),stderr=Buffer.concat(err).toString();
      if(code!==0)reject(Object.assign(new Error('Original native command failed: '+args[0]+' ('+(signal??code)+')\n'+stderr+'\n'+stdout.toString().slice(-8000)),{code:'ORIGINAL_PROCESS_FAILED'}));
      else resolveRun({stdout,stderr});});
    child.stdin.end(input);
  });
}
async function native(python,owner,environment,payload){
  const s=owner.spending;
  const result=await run(python,['-I','-B',HELPER,'--actor',s.actor,'--service',s.service,
    '--policy',s.policy,'--ledger',s.ledger,'--state-directory',s.stateDirectory],
    {environment,input:JSON.stringify(payload)});
  const parsed=JSON.parse(result.stdout);
  assert.equal(parsed.schema,'stellar-forge.mcp-spending.v1');
  assert.notEqual(parsed.outcome,'ERROR');return parsed;
}
async function openReceived(python,source,state){
  const child=spawn(python,['-B',source,'--state',state,'--port','0','--node',process.execPath],
    {stdio:['ignore','pipe','pipe'],shell:false});
  let output='',error='';child.stderr.on('data',part=>{if(error.length<32768)error+=part;});
  const exited=new Promise(resolveExit=>child.once('exit',(code,signal)=>resolveExit({code,signal})));
  const startup=await new Promise((resolveReady,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Received original server did not start: '+error));},30000);
    child.once('error',reason=>{clearTimeout(timer);reject(reason);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Received original server exited before startup: '+code+' '+error));});
    child.stdout.on('data',part=>{output+=part;if(output.includes('\n')){
      try{const ready=JSON.parse(output.split('\n')[0]);clearTimeout(timer);resolveReady(ready);}
      catch(reason){child.kill('SIGTERM');clearTimeout(timer);reject(reason);}
    }});
  });
  const url=new URL(startup.url),token=url.hash.slice(1);
  assert.equal(url.hostname,'127.0.0.1');assert.ok(token.length>=24);
  const request=async(path,body)=>{
    const response=await fetch(url.origin+path,{method:body===undefined?'GET':'POST',
      headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json',Origin:url.origin})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
    const raw=Buffer.from(await response.arrayBuffer());
    assert.equal(response.status,200,raw.toString().slice(0,3000));
    return response.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):raw;
  };
  return {request,async close(){child.kill('SIGTERM');const end=await exited;assert.equal(end.code,0,error);}};
}

export async function runGovernedBuyerExpenseReceiving({work,python='/usr/bin/python3'}={}){
  assert.ok(isAbsolute(work??'')&&isAbsolute(python));
  process.umask(0o077);
  await mkdir(work,{mode:0o700});work=await realpath(work);
  const report={operation:OPERATION,dataContext:'development',startedAt:new Date().toISOString(),phase:'preparing',
    sourceRoot:ROOT,node:process.version,phases:[],mutations:[],exports:[]};
  const reportFile=join(work,'operation.json');
  const save=()=>writeFile(reportFile,json(report),{mode:0o600});
  const phase=async(name,detail={})=>{report.phase=name;report.phases.push({name,at:new Date().toISOString(),...detail});await save();process.stdout.write(JSON.stringify({operation:OPERATION,phase:name,...detail})+'\n');};
  let provider,received;
  try{
    // The complete finance process has no SF36 control-key environment. The
    // separately invoked original owner receives only these fresh fixture keys.
    for(const name of KEYS)delete process.env[name];
    const fixtureEnvironment={...process.env};
    for(const name of KEYS)fixtureEnvironment[name]=randomBytes(32).toString('base64');
    await privateWrite(join(work,'fixture-control-environment.json'),Object.fromEntries(KEYS.map(name=>[name,fixtureEnvironment[name]])));
    const payer='GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const recipient='GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
    const asset='CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ';
    const network='stellar:testnet',profile=networkProfile(network);
    const policy=join(work,'policy.json'),ledger=join(work,'spending.sqlite'),state=join(work,'native-spending');
    await privateWrite(policy,{schema:'stellar-spend-governor/v1',assets:[{network,asset,
      max_single:'1000',max_total:'1000',max_per_utc_day:'1000',max_per_actor_utc_day:'1000',max_per_service_utc_day:'1000'}]});
    const owner={schema:'stellar-forge.mcp-spending-host.v1',payer,signerSecretEnv:'DEVELOPMENT_WALLET_UNUSED',
      rpcUrl:profile.defaultRpc,limits:{network,asset,payTo:recipient,maxAtomic:'1000',maxTimeoutSeconds:60},
      spending:{python,actor:'finance-receiving-buyer',service:'selected-tools',policy,ledger,stateDirectory:state}};
    const host=join(work,'native-host.json');await privateWrite(host,owner);
    const endpoint='https://merchant.example/mcp';
    const invocation=prepareMcpInvocation({resource:{url:endpoint},input:{toolName:'finance_source',
      inputSchema:{type:'object',properties:{selection:{type:'string'}},required:['selection']},transport:'streamable-http'}},
      {arguments:{selection:'original-controlled-finance-case'}});
    const accepted={scheme:'exact',network,asset,amount:'60',payTo:recipient,maxTimeoutSeconds:60,
      extra:{areFeesSponsored:true,paymentFlow:'authorization'}};
    const at=Date.now();
    let quote={quoteId:randomUUID(),resource:'selected-finance-tool',url:endpoint,method:'tools/call',invocation,
      accepted,fingerprint:hash(JSON.stringify(accepted)),operatorScope:'governed-finance-development',
      createdAt:at,updatedAt:at,expiresAt:at+3600000,status:'EXECUTING',phase:'SIGNING',
      attempts:1,signedRequestDispatched:false,result:null,failure:null};
    const quoteDirectory=join(work,'quotes'),copiedQuotes=join(work,'copied-quotes');
    const saveQuote=directory=>{const store=new SqliteQuoteStore({directory});try{store.save(quote);}finally{store.close();}};
    saveQuote(quoteDirectory);saveQuote(copiedQuotes);
    const binding=mcpSpendingBinding({...quote,requestUrl:quote.url},{...owner.spending,payer});
    const reserved=await native(python,owner,fixtureEnvironment,{action:'reserve',binding});
    assert.equal(reserved.outcome,'RESERVED');assert.equal(reserved.reservation.state,'reserved');
    const other={...owner,spending:{...owner.spending,actor:'other-original-application',stateDirectory:join(work,'other-native-spending')}};
    const otherQuote={...quote,quoteId:randomUUID(),accepted:{...accepted,amount:'11'}};
    const otherBinding=mcpSpendingBinding({...otherQuote,requestUrl:otherQuote.url},{...other.spending,payer});
    assert.equal((await native(python,other,fixtureEnvironment,{action:'reserve',binding:otherBinding})).outcome,'RESERVED');
    const descriptor=join(work,'governed-source.json'),copyDescriptor=join(work,'copied-governed-source.json');
    await privateWrite(descriptor,{schema:'stellar-forge.governed-mcp-expense-input.v1',quoteDirectory,spendingConfigurationFile:host});
    await privateWrite(copyDescriptor,{schema:'stellar-forge.governed-mcp-expense-input.v1',quoteDirectory:copiedQuotes,spendingConfigurationFile:host});
    const exportsDirectory=join(work,'exports');await mkdir(exportsDirectory,{mode:0o700});
    const connectionFile=join(work,'expense-connection.json');
    const selected={path:descriptor,name:'Governed original selected buyer',provenance:'Controlled original native quote/binding/SF36 operation; selected owner only.',dataContext:'development'};
    const connection={schema:BUYER_EXPENSE_CONNECTION_SCHEMA,workspaces:{
      buyer:{directory:join(work,'expenses'),python,ledgers:{shared:{path:ledger,name:'Original complete shared ledger',provenance:'The same original SF36 ledger, including its other application.',dataContext:'development'}},
        governedQuoteSources:{selected}},
      copied:{directory:join(work,'copied-expenses'),python,governedQuoteSources:{selected:{...selected,path:copyDescriptor,name:'Copied quote source recovery'}}}
    }};
    await privateWrite(connectionFile,connection);
    const openProvider=async()=>{provider=new MerchantBuyerExpenses({buyerExpenses:await readBuyerExpenseConfiguration(connectionFile),exportsDirectory});};
    await openProvider();
    const call=(action,args={})=>provider.call(PREFIX+action,args);
    const stateOf=workspace=>call('state',{workspace});
    let sequence=0;
    const mutate=async(action,args={},workspace='buyer',requestId)=>{
      const state=await stateOf(workspace),id=requestId??'governed-finance-'+String(++sequence).padStart(4,'0');
      const selection={workspace,requestId:id,expectedRevision:state.revision,...args};
      const result=await call(action,selection);
      report.mutations.push({action,workspace,requestId:id,expectedRevision:state.revision,revision:result.revision});
      await save();return {response:result,result:result.result,args:selection};
    };
    const accept=async(capture,workspace='buyer')=>mutate('capture_review',{id:capture.id,decision:'ACCEPT',operator:'Receiving operator',
      reason:'Reviewed exact original source identity, operation context, reservation and row changes.'},workspace);
    const refresh=async(sourceId,workspace='buyer')=>{const captured=await mutate('capture',{sourceId},workspace);await accept(captured.result,workspace);return captured;};
    const items=async(sourceId,workspace='buyer')=>(await call('items',{workspace,sourceId,limit:200})).items;
    const rows=async(periodId,view)=>(await call('period_report',{workspace:'buyer',id:periodId,view,limit:200})).rows.items;
    const total=values=>values.reduce((sum,value)=>sum+BigInt(value.amount),0n).toString();
    await call('open',{workspace:'buyer'});
    await assert.rejects(call('governed_mcp_register',{workspace:'buyer',requestId:'undeclared-source',expectedRevision:(await stateOf('buyer')).revision,governedSource:'undeclared'}));
    const selectedRegistration=await mutate('governed_mcp_register',{governedSource:'selected'});
    const selectedId=selectedRegistration.result.id;await accept(selectedRegistration.result.capture);
    const directRegistration=await mutate('ledger_register',{ledger:'shared'});
    const directId=directRegistration.result.id;await accept(directRegistration.result.capture);
    const selectedRows=await items(selectedId);assert.equal(selectedRows.length,1);
    assert.equal(selectedRows[0].row.request_id,quote.quoteId);assert.equal(selectedRows[0].row.reserved_base_units,'60');
    assert.equal(selectedRows[0].status,'RESERVED');
    const sourceView=(await call('state',{workspace:'buyer',view:'sources',limit:200})).rows.items.find(value=>value.id===selectedId);
    assert.equal(sourceView.rows,1);assert.equal(sourceView.spending_owner.actor,owner.spending.actor);
    const date=new Date(),year=date.getUTCFullYear(),month=date.getUTCMonth();
    const iso=value=>value.toISOString().slice(0,10);
    const firstDay=iso(new Date(Date.UTC(year,month,1))),lastDay=iso(new Date(Date.UTC(year,month+1,0)));
    const nextDay=iso(new Date(Date.UTC(year,month+1,1))),nextLast=iso(new Date(Date.UTC(year,month+2,0)));
    const period=(await mutate('period_save',{payload:{name:'Original purchase period',from_day:firstDay,through_day:lastDay}})).result;
    const outstanding=await rows(period.id,'outstanding_reservations');
    assert.equal(outstanding.length,2);assert.equal(total(outstanding),'71');
    const ownExposure=outstanding.find(value=>value.request_id===quote.quoteId);
    assert.equal(ownExposure.amount,'60');assert.equal(ownExposure.contributing_sources.length,2);
    assert.equal((await rows(period.id,'issues')).filter(value=>value.code==='UNRESOLVED_RESERVATION').length,2);
    await phase('original-shared-reservation-received',{quoteId:quote.quoteId,requestSha256:reserved.request_sha256,
      selectedReserved:'60',completeLedgerReserved:'71',contributingSources:2});

    // Only this operation owns the fixture owner. The copied quote source keeps
    // its own financial review history; the exact original binding is restored
    // even if the copied-case capture fails.
    await call('open',{workspace:'copied'});
    const bindingPath=join(state,quote.quoteId+'.json'),savedBinding=bindingPath+'.receiving-preserved';
    await rename(bindingPath,savedBinding);
    let copiedRegistration;
    try{
      copiedRegistration=await mutate('governed_mcp_register',{governedSource:'selected'},'copied');
      await accept(copiedRegistration.result.capture,'copied');
      const missing=(await items(copiedRegistration.result.id,'copied'))[0];
      assert.equal(missing.status,'SPENDING_SOURCE_REVIEW');assert.equal(missing.row.reserved_base_units,'60');
      const center=(await mutate('center_save',{payload:{code:'COPY',name:'Copied review'}},'copied')).result;
      await assert.rejects(mutate('coding_save',{id:missing.id,payload:{basis:missing.basis,recognition_date:firstDay,
        operator:'Receiving operator',allocations:[{center_id:center.id,amount:'60'}]}},'copied'));
    }finally{await rename(savedBinding,bindingPath);}
    await refresh(copiedRegistration.result.id,'copied');
    const repaired=(await items(copiedRegistration.result.id,'copied'))[0];
    assert.equal(repaired.status,'RESERVED');assert.equal(repaired.row.reserved_base_units,'60');
    await phase('copied-source-binding-recovered',{retainedReserve:'60',codingRecovered:'RESERVED',
      sourceId:copiedRegistration.result.id});

    const transaction=hash('controlled-native-finance-transaction:'+quote.quoteId),checkedAt=new Date().toISOString();
    const observation={schema:'stellar-forge.sf86.payment-attempt.v1',outcome:'TRANSFER_MATCHED',rpcStatus:'SUCCESS',
      intentId:quote.quoteId,network,asset,payer,recipient,atomicAmount:'60',transaction,
      source:profile.rpcSource,rpcEndpoint:profile.defaultRpc,checkedAt,ledger:12345,
      networkResultSha256:hash('controlled-network-result'),transactionResultSha256:hash('controlled-transaction-result')};
    observation.transfer={schema:'stellar-forge.sf86.rpc-reconciliation.v1',verdict:profile.transferVerdict,
      intentId:quote.quoteId,network,asset,payer,recipient,atomicAmount:'60',transaction,
      source:profile.rpcSource,rpcEndpoint:profile.defaultRpc,networkPassphrase:profile.passphrase,ledger:12345,
      matchingTransfers:1,matchingEventId:'controlled-original-event-'+quote.quoteId,eventPages:1,
      networkResultSha256:observation.networkResultSha256,transactionResultSha256:observation.transactionResultSha256,
      eventPageSha256:[hash('controlled-event-page')]};
    const result=Buffer.from(JSON.stringify({selection:'original-controlled-finance-case',rows:[{value:'complete original result',units:'60'}]})+'\n');
    await privateWrite(join(work,'original-result.json'),result);
    quote={...quote,updatedAt:Date.now(),status:'CONFIRMED_BY_SERVER',phase:'COMPLETE',signedRequestDispatched:true,
      result:{paymentResponse:{success:true,network,transaction},reconciliation:observation,
        content:{body:result.toString(),contentType:'application/json'},
        responseFile:{status:'COMPLETE',path:join(work,'original-result.json'),bytes:result.length,sha256:hash(result),contentType:'application/json'}}};
    assert.equal(inspectSavedMcpPayment(quote).classification,'TRANSFER_MATCHED');saveQuote(quoteDirectory);
    await privateWrite(join(work,'original-controlled-payment-observation.json'),observation);
    await refresh(selectedId);
    const pending=(await items(selectedId))[0];
    assert.equal(pending.row.reserved_base_units,'60');assert.equal(pending.row.native_detail.observed_settled_actual,'60');
    const settled=await native(python,owner,fixtureEnvironment,{action:'finalize',quoteId:quote.quoteId,proof:observation});
    assert.equal(settled.reservation.state,'settled');assert.equal(settled.reservation.actual,'60');
    await refresh(selectedId);
    const divergent=await rows(period.id,'issues');
    assert.ok(divergent.some(value=>value.code.startsWith('SPENDING_CAPTURE_DIVERGENCE_')&&!value.resolved));
    await refresh(directId);
    assert.ok(!(await rows(period.id,'issues')).some(value=>value.code.startsWith('SPENDING_CAPTURE_DIVERGENCE_')));
    assert.equal(total(await rows(period.id,'outstanding_reservations')),'11');
    const selectedItem=(await items(selectedId))[0],directItem=(await items(directId)).find(value=>value.row.request_id===quote.quoteId);
    assert.equal(selectedItem.row.settled_base_units,'60');assert.equal(selectedItem.row.reserved_base_units,'0');
    await phase('original-finality-and-source-refresh',{settled:'60',otherOwnerReserved:'11',
      originalResultSha256:hash(result),originalResultBytes:result.length});

    const center1=(await mutate('center_save',{payload:{code:'DATA',name:'Data operations'}})).result;
    const center2=(await mutate('center_save',{payload:{code:'SERVICE',name:'Client service'}})).result;
    const code=async(item,recognition)=>mutate('coding_save',{id:item.id,payload:{basis:item.basis,recognition_date:recognition,
      operator:'Receiving finance operator',memo:'Original selected purchase, reviewed exact units.',
      allocations:[{center_id:center1.id,amount:'40',project:'Native buyer',account_code:'6100'},
                   {center_id:center2.id,amount:'20',project:'Client delivery',account_code:'6200'}]}});
    await code(directItem,firstDay);
    const resolveIssues=async(id,included)=>{
      for(let round=0;round<5;round++){
        const open=(await rows(id,'issues')).filter(value=>!value.resolved);if(!open.length)return;
        for(const issue of open){
          assert.ok(issue.allowed_kinds.length,JSON.stringify(issue));
          const kind=issue.code==='SHARED_RECEIPT_REFERENCE'&&issue.item_id===included?'include_original_charge':
            issue.code==='UNRESOLVED_RESERVATION'?'carry_forward':'exclude_from_period';
          assert.ok(issue.allowed_kinds.includes(kind),JSON.stringify(issue));
          await mutate('disposition',{periodId:id,payload:{item_id:issue.item_id,code:issue.code,basis:issue.basis,kind,
            operator:'Receiving finance operator',reason:kind==='include_original_charge'?'Select this one original charge; the other source is the same original ledger row.':
              kind==='carry_forward'?'The other application retains its original reservation for later completion.':
              'Keep this duplicate or other-period representation as retained source history without a second charge.'}});
        }
      }
      assert.fail('Original period still has unresolved review decisions.');
    };
    const issuePeriod=async(id)=>{
      const reviewed=await mutate('period_review',{id,reviewer:'Receiving reviewer',role:'Finance operator',
        notes:'Reviewed original source identities, exact allocation totals, duplicate representations and remaining native reservation.'});
      assert.equal(reviewed.result.decision,'READY');
      return mutate('period_close',{id,reviewId:reviewed.result.id});
    };
    await resolveIssues(period.id,directItem.id);
    assert.equal(total(await rows(period.id,'allocations')),'60');
    const firstClose=await issuePeriod(period.id);
    const firstLines=(await call('issued',{workspace:'buyer',id:firstClose.result.id,view:'allocations',limit:200})).rows.items;
    assert.equal(firstLines.length,2);assert.ok(firstLines.every(line=>line.original_spending_reservation?.request_digest===reserved.request_sha256));
    assert.ok(firstLines.every(line=>line.native_payment===null));
    const later=(await mutate('period_save',{payload:{name:'Following recognition period',from_day:nextDay,through_day:nextLast}})).result;
    await code(selectedItem,nextDay);
    const crossPeriod=await rows(later.id,'issues');
    assert.ok(crossPeriod.some(value=>value.code==='TRANSFER_ALREADY_ISSUED'&&value.item_id===selectedItem.id&&!value.resolved));
    assert.equal(total(await rows(later.id,'allocations')),'0');
    const refused=(await mutate('period_review',{id:later.id,reviewer:'Receiving reviewer',role:'Finance operator',
      notes:'The original earlier period already includes this exact spending reservation.'})).result;
    assert.equal(refused.decision,'REQUIRES_CORRECTION');
    await assert.rejects(mutate('period_close',{id:later.id,reviewId:refused.id}));
    await phase('cross-period-original-charge-preserved',{firstClose:firstClose.result.id,followingPeriod:later.id,
      firstRepresentation:'sf36_ledger',secondRepresentation:'governed_mcp',firstPeriodTotal:'60',followingPeriodTotal:'0'});

    await mutate('period_reopen',{id:period.id,operator:'Receiving finance operator',
      reason:'Replace the duplicate source representation with its governed buyer view while preserving the original issued edition.'});
    await code(await call('item',{workspace:'buyer',id:selectedItem.id}),firstDay);
    // A new decision on the same exact issue intentionally changes which
    // original representation is included in the reopened period.
    for(const issue of await rows(period.id,'issues')){
      if(issue.code==='SHARED_RECEIPT_REFERENCE'){
        const kind=issue.item_id===selectedItem.id?'include_original_charge':'exclude_from_period';
        await mutate('disposition',{periodId:period.id,payload:{item_id:issue.item_id,code:issue.code,basis:issue.basis,kind,
          operator:'Receiving finance operator',reason:'The governed buyer view is the selected original charge for the revised edition; preserve the duplicate ledger view.'}});
      }
    }
    await resolveIssues(period.id,selectedItem.id);
    assert.equal(total(await rows(period.id,'allocations')),'60');
    const finalClose=await issuePeriod(period.id);
    const finalLines=(await call('issued',{workspace:'buyer',id:finalClose.result.id,view:'allocations',limit:200})).rows.items;
    assert.equal(finalLines.length,2);assert.ok(finalLines.every(line=>line.source_kind==='governed_mcp'));
    assert.ok(finalLines.every(line=>line.native_payment.spending_request_sha256===reserved.request_sha256));
    assert.equal(finalClose.result.sequence,2);
    await phase('reopened-original-edition-issued',{closeId:finalClose.result.id,priorClose:firstClose.result.id,total:'60',allocationLines:2});

    const exportFile=async(kind,exportId,recordId,workspace='buyer')=>{
      const selected={workspace,kind,exportId,...(recordId?{recordId}:{}),
        ...(['project','bookkeeping'].includes(kind)?{expectedRevision:(await stateOf(workspace)).revision}:{})};
      const status=await call('export',selected);assert.equal(status.state,'COMPLETE');
      const metadata=status.manifest.files[0],chunks=[];let offset=0,readId;
      do{
        const chunk=await call('file',{exportId,file:metadata.name,expectedManifestSha256:status.manifestSha256,
          expectedSha256:metadata.sha256,offset,limit:32768,...(readId?{readId}:{})});
        assert.equal(chunk.offset,offset);chunks.push(Buffer.from(chunk.data,'base64'));
        readId=chunk.readId;offset=chunk.nextOffset;
      }while(offset!==null);
      const bytes=Buffer.concat(chunks);assert.equal(bytes.length,metadata.bytes);assert.equal(hash(bytes),metadata.sha256);
      report.exports.push({exportId,kind,...metadata,manifestSha256:status.manifestSha256});await save();
      return {bytes,status,selection:selected,path:join(exportsDirectory,'buyer-expenses',exportId,'payload',metadata.name)};
    };
    const buyerSource=await exportFile('buyer-accountant-source','original-issued-source',finalClose.result.id);
    const handoff=createHandoff({buyerSourceBytes:buyerSource.bytes,name:'Original governed buyer period',actor:'Receiving accountant'});
    const csv=renderCsv(handoff),parsed=parseReturnCsv(csv,{columns:accountantColumns(handoff)});
    const quoteCsv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
    const returnedCsv=Buffer.from([parsed.headers.map(quoteCsv).join(','),...parsed.records.map((record,index)=>{
      const values=Object.fromEntries(parsed.headers.map((key,i)=>[key,record.values[i]]));
      Object.assign(values,{externalStatus:'BOOKED',externalBookRef:'DEVELOPMENT-BOOK-'+(index+1),
        externalAccountCode:values.account_code||'6100',externalNote:'Received original allocation; native units and source identity retained.'});
      return parsed.headers.map(key=>quoteCsv(values[key])).join(',');
    })].join('\r\n')+'\r\n');
    const revision=importReturn({handoff,csvBytes:returnedCsv,actor:'Receiving accountant',name:'Original completed bookkeeping return'});
    const accountantView=inspectHandoff(handoff,revision);
    assert.equal(accountantView.rows.length,2);assert.ok(accountantView.rows.every(row=>row.externalStatus==='BOOKED'));
    const packet=createBuyerReturnPacket({handoff,revisions:[revision],buyerSourceBytes:buyerSource.bytes});
    const packetFile=join(work,'accountant-return.json'),packetBytes=json(packet);
    await privateWrite(packetFile,packetBytes);
    await privateWrite(join(work,'accountant-template.csv'),csv);await privateWrite(join(work,'returned-accountant.csv'),returnedCsv);
    await provider.close();provider=null;
    connection.workspaces.buyer.accountantSources={returned:{sourceFile:packetFile,sourceSha256:hash(packetBytes),
      name:'Original completed buyer return',provenance:'Original accountant engine import of the two frozen buyer allocations.'}};
    await writeFile(connectionFile,json(connection),{mode:0o600});
    await openProvider();await call('open',{workspace:'buyer'});
    const preview=await call('accountant_preview',{workspace:'buyer',closeId:finalClose.result.id,accountantSource:'returned'});
    assert.equal(preview.native.counts.rows,2);
    const savedReturn=await mutate('accountant_return_save',{closeId:finalClose.result.id,accountantSource:'returned',
      previewSha256:preview.preview_sha256,operator:'Receiving finance operator',name:'Original accountant return',
      reason:'Reviewed the same two issued allocations and original bookkeeping chain.',supersedes:[]});
    const savedRevision=(await stateOf('buyer')).revision;
    const recoveredReturn=await call('accountant_return_save',savedReturn.args);
    assert.equal(recoveredReturn.result.id,savedReturn.result.id);assert.equal((await stateOf('buyer')).revision,savedRevision);
    const returned=(await call('accountant_return',{workspace:'buyer',id:savedReturn.result.id,view:'rows',limit:200})).native.rows.items;
    assert.equal(returned.length,2);assert.ok(returned.every(row=>row.externalStatus==='BOOKED'));
    const accountantArchive=await exportFile('accountant','original-accountant-edition',finalClose.result.id);
    const bookkeeping=await exportFile('bookkeeping','original-bookkeeping',finalClose.result.id);
    const project=await exportFile('project','complete-private-project');
    await phase('original-accountant-return-and-complete-exports',{returnId:savedReturn.result.id,
      accountantRows:2,projectSha256:hash(project.bytes),projectBytes:project.bytes.length,
      accountantArchiveSha256:hash(accountantArchive.bytes),bookkeepingSha256:hash(bookkeeping.bytes)});

    await provider.close();provider=null;
    const destination=join(work,'received');
    const receiving=await run(python,['-B',join(APP,'receive.py'),'--archive',project.path,'--directory',destination,
      '--expected-sha256',hash(project.bytes)]);
    const receipt=JSON.parse(receiving.stdout);
    assert.equal(receipt.state,'RECEIVED');assert.equal(receipt.accountant_return_count,1);
    assert.ok(receipt.source_kinds.includes('governed_mcp'));
    const exactAgain=JSON.parse((await run(python,['-B',join(APP,'receive.py'),'--archive',project.path,'--directory',destination,
      '--expected-sha256',hash(project.bytes)])).stdout);
    assert.equal(exactAgain.archive_sha256,receipt.archive_sha256);
    received=await openReceived(python,receipt.application,join(destination,'project'));
    const receivedState=await received.request('/api/state');
    assert.equal(receivedState.revision,savedRevision);assert.equal(receivedState.accountant_return_count,1);
    const exactIssued=await received.request('/api/closes/'+finalClose.result.id);
    assert.equal(total(exactIssued.allocations),'60');assert.equal(exactIssued.sequence,2);
    const replay=await received.request('/api/periods/'+period.id+'/close',{
      request_id:finalClose.args.requestId,expected_revision:finalClose.args.expectedRevision,payload:{review_id:finalClose.args.reviewId}});
    assert.equal(replay.result.id,finalClose.result.id);
    assert.equal((await received.request('/api/state')).revision,savedRevision);
    const receivedReturns=await received.request('/api/closes/'+finalClose.result.id+'/accountant-returns');
    assert.equal(receivedReturns.items.length,1);
    await received.request('/api/periods/'+period.id+'/reopen',{request_id:'received-original-reopen',
      expected_revision:savedRevision,payload:{operator:'Receiving maintainer',reason:'Continue this original project after verified receiving.'}});
    let current=await received.request('/api/state');
    // This executes the included governed Node reader, not the source checkout.
    const recapture=await received.request('/api/sources/'+selectedId+'/capture',{
      request_id:'received-original-source-capture',expected_revision:current.revision,payload:{}});
    current=await received.request('/api/state');
    await received.request('/api/captures/'+recapture.result.id+'/decision',{request_id:'received-original-source-review',
      expected_revision:current.revision,payload:{decision:'ACCEPT',operator:'Receiving maintainer',
        reason:'The original host, request, complete ledger and quote result still match this received project.'}});
    current=await received.request('/api/state');
    const receivedItems=await received.request('/api/expenses?source='+encodeURIComponent(selectedId));
    assert.equal(receivedItems.items[0].row.settled_base_units,'60');
    const browserModule=await received.request('/app.mjs');assert.ok(Buffer.isBuffer(browserModule)&&browserModule.includes(Buffer.from('governed_mcp')));
    await received.close();received=null;
    const replayedReservation=await native(python,owner,fixtureEnvironment,{action:'reserve',binding});
    assert.equal(replayedReservation.outcome,'IDEMPOTENT_EXISTING');assert.equal(replayedReservation.reservation.state,'settled');
    assert.equal(replayedReservation.reservation.actual,'60');
    await phase('included-application-received-and-continued',{receivedDirectory:destination,
      successfulRequests:receipt.successful_requests,sourceKinds:receipt.source_kinds,receivedRevision:current.revision,
      originalReservationReplay:replayedReservation.outcome});
    report.outcome='PASS';report.completedAt=new Date().toISOString();report.phase='complete';
    report.original={quoteId:quote.quoteId,requestSha256:reserved.request_sha256,transaction,
      selectedSettled:'60',otherOwnerReserved:'11',firstCloseId:firstClose.result.id,closeId:finalClose.result.id,
      accountantReturnId:savedReturn.result.id,workspaceId:receivedState.id,sourceId:selectedId,ledgerSourceId:directId};
    report.receiving=receipt;await save();return report;
  }catch(error){
    report.outcome='FAILED';report.failedAt=new Date().toISOString();report.error={name:error.name,code:error.code??null,message:error.message,stack:error.stack};
    await save();throw error;
  }finally{
    if(received)await received.close();
    if(provider)await provider.close();
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{work:{type:'string'},python:{type:'string'}}});
  try{const result=await runGovernedBuyerExpenseReceiving({work:values.work,python:values.python});process.stdout.write(JSON.stringify(result)+'\n');}
  catch(error){process.stderr.write(JSON.stringify({operation:OPERATION,outcome:'FAILED',code:error.code??null,message:error.message})+'\n');process.exitCode=1;}
}
