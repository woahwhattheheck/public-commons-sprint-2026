// MIT. Complete native historical interval acquisition and reusable source selection.
import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,writeFile,mkdir,rename,unlink,realpath,lstat} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {hostname} from 'node:os';
import {pathToFileURL} from 'node:url';
import {need,plain,parseNativeJSON} from './source.mjs';
import {decodeArchiveLedgerPage} from './archive.mjs';

export const LEDGER_INTERVAL_DEFAULTS=Object.freeze({
  network:'mainnet',networkPassphrase:'Public Global Stellar Network ; September 2015',
  rpcUrl:'https://archive-rpc.lightsail.network/',pageSize:8,
  accounts:['GD2IBAC2WK3XOD64APP4OKQTX4URQFAH5WRHODEOJF7EN2MLDOV45VKI'],
  contractIds:['CAIRWEYKTLVRQBXQGYNLDUAKWIUV4NO6WPTCMVHH2BOMUUUBTXRJF43R'],
});
const SCHEMA='stellar-forge.givecredit-ledger-interval.v1';
const SELECT_SCHEMA='stellar-forge.givecredit-ledger-selection.v1';
const HASH=/^[a-f0-9]{64}$/i;
const now=()=>new Date().toISOString();
const digest=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>JSON.stringify(value,(_,v)=>plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const defined=value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));
const inside=(root,path)=>{const rel=relative(root,path);return rel!==''&&!rel.startsWith('..'+String.fromCharCode(47))&&rel!=='..'&&!isAbsolute(rel);};
const utf8=buffer=>{const content=new TextDecoder('utf-8',{fatal:true}).decode(buffer);need(Buffer.from(content).equals(buffer),'HISTORY_UTF8','Retain the complete original UTF-8 response bytes.');return content;};
function integer(value,label,{zero=false,max=4294967295n}={}){
  need(value!==null&&value!==undefined&&/^\d+$/.test(String(value)),'HISTORY_INTEGER','Provide the exact '+label+'.');
  const n=BigInt(value);need(n>=(zero?0n:1n)&&n<=max,'HISTORY_INTEGER','The '+label+' is outside its native range.');return n.toString();
}
function endpoint(value){
  const url=new URL(value||LEDGER_INTERVAL_DEFAULTS.rpcUrl);
  need((url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))&&!url.username&&!url.password&&!url.search&&!url.hash,
    'HISTORY_RPC_URL','Select the existing public archive RPC URL without credentials or query parameters.');
  return url.href;
}
function strings(values,label){
  need(Array.isArray(values)&&values.every(v=>typeof v==='string'&&v.length),'HISTORY_SELECTION','Provide original '+label+' as an array.');
  return [...new Set(values)].sort();
}
function selectedAddresses(sdk,options,baseline={}){
  const accounts=strings(options.accounts??baseline.accounts??(baseline.account?[baseline.account]:LEDGER_INTERVAL_DEFAULTS.accounts),'accounts');
  const contractIds=strings(options.contractIds??baseline.contractIds??(baseline.contractId?[baseline.contractId]:LEDGER_INTERVAL_DEFAULTS.contractIds),'GiveCredit contract IDs');
  const additionalAddresses=strings(options.addresses||[],'additional source addresses');
  const addresses=strings([...additionalAddresses,...accounts,...contractIds],'source addresses');
  for(const account of accounts){need(account.startsWith('G'),'HISTORY_ACCOUNT','Horizon accounts must be original G addresses.');sdk.StrKey.decodeEd25519PublicKey(account);}
  for(const contract of contractIds){need(contract.startsWith('C'),'HISTORY_CONTRACT','Use the selected original GiveCredit contract IDs.');sdk.StrKey.decodeContract(contract);}
  for(const address of addresses){
    need(/^[GC][A-Z2-7]{55}$/.test(address),'HISTORY_ADDRESS','Select an original account or contract address.');
    if(address[0]==='G')sdk.StrKey.decodeEd25519PublicKey(address);else sdk.StrKey.decodeContract(address);
  }
  need(addresses.length,'HISTORY_SELECTION','Select at least one original address.');
  return {accounts,contractIds,additionalAddresses,addresses,
    basis:'Original transaction source, fee source, native operation address, invoked contract or native contract argument. Additional source addresses select records without changing GiveCredit contract classification.'};
}
function selectionOptions(previous,options){
  return {accounts:previous.accounts,contractIds:previous.contractIds,
    addresses:previous.additionalAddresses??previous.addresses.filter(address=>!previous.accounts.includes(address)&&!previous.contractIds.includes(address)),
    ...defined(options)};
}
async function nativeSDK(options){
  const sdk=options.sdk||(options.sdkModule?await import(pathToFileURL(resolve(options.sdkModule)).href):await import('@stellar/stellar-sdk'));
  need(sdk?.StrKey&&sdk?.TransactionBuilder&&sdk?.xdr?.LedgerCloseMeta,'HISTORY_SDK','Use the existing complete native Stellar SDK.');
  return sdk;
}
async function atomic(path,value){
  const temporary=path+'.'+randomUUID()+'.tmp',handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');await handle.sync();}
  finally{await handle.close();}
  await rename(temporary,path);
}
async function newFile(root,file,content){
  const path=join(root,file);await writeFile(path,content,{flag:'wx',mode:0o600});
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);
  return {file,bytes:bytes.length,sha256:digest(bytes)};
}
async function stored(root,file){
  need(typeof file==='string'&&file.length&&!isAbsolute(file)&&!file.split(/[\\/]/).includes('..'),
    'HISTORY_FILE','Use an original relative retained file path.');
  const path=join(root,file),stat=await lstat(path),actual=await realpath(path);
  need(stat.isFile()&&!stat.isSymbolicLink()&&inside(root,actual),'HISTORY_FILE','Read original regular files inside the selected history directory.');
  return readFile(path);
}
async function verified(root,record){
  need(plain(record)&&HASH.test(record.sha256)&&Number.isSafeInteger(record.bytes)&&record.bytes>=0,'HISTORY_FILE_IDENTITY','Retain each original file size and SHA-256.');
  const data=await stored(root,record.file);
  need(data.length===record.bytes&&digest(data)===record.sha256,'HISTORY_SOURCE_CHANGED','Retained source '+record.file+' differs from its recorded whole bytes.');
  return data;
}
async function processIdentity(pid=process.pid){
  let bootId=null,startTicks=null;
  try{bootId=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();}catch{}
  try{const stat=await readFile('/proc/'+pid+'/stat','utf8');startTicks=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19];}catch{}
  return {pid,hostname:hostname(),bootId,startTicks};
}
async function acquireLock(directory){
  const path=join(directory,'history.lock'),identity=await processIdentity();
  const claim={...identity,startedAt:now(),nonce:randomUUID()};
  for(let attempt=0;attempt<2;attempt++){
    try{await writeFile(path,JSON.stringify(claim,null,2)+'\n',{flag:'wx',mode:0o600});break;}
    catch(error){
      if(error.code!=='EEXIST'||attempt)throw error;
      const previous=JSON.parse(utf8(await stored(directory,'history.lock')));
      let stale=previous.bootId&&identity.bootId&&previous.bootId!==identity.bootId;
      if(!stale&&previous.hostname===identity.hostname&&Number.isSafeInteger(previous.pid)){
        try{process.kill(previous.pid,0);const actual=await processIdentity(previous.pid);stale=Boolean(previous.startTicks&&actual.startTicks&&previous.startTicks!==actual.startTicks);}
        catch(problem){stale=problem.code==='ESRCH';}
      }
      need(stale,'HISTORY_IN_USE','This history directory is already owned by native process '+previous.pid+' on '+previous.hostname+'. Resume that process or select its completed files.');
      const archive='history-lock-'+randomUUID()+'.json';await rename(path,join(directory,archive));
    }
  }
  return async()=>{
    try{const retained=JSON.parse(await readFile(path,'utf8'));if(retained.nonce===claim.nonce)await unlink(path);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  };
}
async function workspace(options,create){
  need(typeof options.sourceRoot==='string'&&typeof options.output==='string','HISTORY_PATHS','Select the bootstrap source root and its private historical output directory.');
  const sourceRoot=await realpath(resolve(options.sourceRoot)),output=resolve(options.output),parent=await realpath(dirname(output));
  need(inside(sourceRoot,output)&&(parent===sourceRoot||inside(sourceRoot,parent)),'HISTORY_PATHS','Keep the history directory inside the received private source root so the whole native archive includes every original page.');
  if(create){
    await mkdir(output,{mode:0o700});
    for(const name of ['responses','selections'])await mkdir(join(output,name),{mode:0o700});
  }else{
    const actual=await realpath(output),stat=await lstat(output);
    need(stat.isDirectory()&&!stat.isSymbolicLink()&&inside(sourceRoot,actual),'HISTORY_PATHS','Open the original private historical directory inside this received source root.');
  }
  return {sourceRoot,output,release:await acquireLock(output)};
}
function ledgerFingerprint(decoded,ledger){
  const hash=createHash('sha256');hash.update(JSON.stringify([ledger.sequence,ledger.hash,ledger.previousLedgerHash,ledger.createdAt,ledger.ledgerCloseTime,ledger.protocol,ledger.transactions]));
  for(const row of decoded.rows)if(row.ledger===ledger.sequence)
    hash.update(JSON.stringify([row.hash,row.applicationOrder,row.envelopeXdr,row.resultXdr,row.resultMetaXdr])+'\n');
  return hash.digest('hex');
}
function ledgerHeaders(decoded){
  return decoded.ledgers.map(ledger=>({...ledger,transactionIdentitySha256:ledgerFingerprint(decoded,ledger)}));
}
function matches(decoded,selection,exchange){
  const addresses=new Set(selection.addresses);
  return decoded.rows.flatMap(row=>{
    const matchedAddresses=row.addresses.filter(address=>addresses.has(address));
    if(!matchedAddresses.length)return [];
    return [{hash:row.hash,hashAliases:row.hashAliases,ledger:row.ledger,ledgerHash:row.ledgerHash,createdAt:row.createdAt,
      applicationOrder:row.applicationOrder,nativeTransactionId:row.nativeTransactionId,successful:row.successful,resultCode:row.resultCode,
      sourceAccount:row.sourceAccount,baseSourceAccount:row.baseSourceAccount,sourceSequence:row.sourceSequence,feeSource:row.feeSource,
      feeBump:row.feeBump,operationKinds:row.operationKinds,contractCalls:row.contractCalls,bumpSequences:row.bumpSequences,
      matchedAddresses,sourceFile:exchange.response.file,sourcePointer:row.sourcePointer,headerPointer:row.headerPointer,nativeXdrPath:row.nativeXdrPath}];
  });
}
function ordered(rows){
  return rows.sort((a,b)=>BigInt(a.ledger)<BigInt(b.ledger)?-1:BigInt(a.ledger)>BigInt(b.ledger)?1:
    BigInt(a.applicationOrder)<BigInt(b.applicationOrder)?-1:BigInt(a.applicationOrder)>BigInt(b.applicationOrder)?1:0);
}
async function loadBaseline(options){
  if(!options.baselineOptionsFile)return {value:{},raw:null};
  const raw=await readFile(resolve(options.baselineOptionsFile)),text=utf8(raw),value=parseNativeJSON(text);
  need(plain(value)&&!value.checkpoint,'HISTORY_BASELINE','Use original source capture options; keep an earlier acquisition checkpoint as its separate source edition.');
  for(const key of ['rpcHeaders','horizonHeaders','archiveHeaders','apiKey'])
    need(value[key]===undefined,'HISTORY_BASELINE_CREDENTIALS','Select public-source capture options without credential headers.');
  return {value,raw};
}
function queryOf(options,baseline){
  const network=options.network??baseline.network??'mainnet';
  const networkPassphrase=options.networkPassphrase??baseline.networkPassphrase??(network==='testnet'?'Test SDF Network ; September 2015':LEDGER_INTERVAL_DEFAULTS.networkPassphrase);
  need(['mainnet','testnet'].includes(network)&&typeof networkPassphrase==='string'&&networkPassphrase.length,'HISTORY_NETWORK','Select the original ledger network and passphrase.');
  need(!baseline.network||baseline.network===network,'HISTORY_NETWORK','The original baseline and archive selection must use the same network.');
  need(!baseline.networkPassphrase||baseline.networkPassphrase===networkPassphrase,'HISTORY_NETWORK','Retain the original baseline network passphrase.');
  const startLedger=integer(options.startLedger,'first inclusive ledger');
  const beforeLedger=integer(options.beforeLedger,'last exclusive ledger',{max:4294967296n});
  need(BigInt(beforeLedger)>BigInt(startLedger),'HISTORY_RANGE','Choose an explicit nonempty historical ledger interval.');
  const pageSize=Number(options.pageSize??LEDGER_INTERVAL_DEFAULTS.pageSize);
  need(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=200,'HISTORY_PAGE_SIZE','Choose a native getLedgers page size from 1 to 200.');
  return {network,networkPassphrase,rpcUrl:endpoint(options.rpcUrl),startLedger,beforeLedger,pageSize};
}
async function loadManifest(output){
  const manifest=JSON.parse(utf8(await stored(output,'history.json')));
  need(manifest.schema===SCHEMA&&plain(manifest.query)&&Array.isArray(manifest.pages)&&Array.isArray(manifest.attempts)&&Array.isArray(manifest.selections),
    'HISTORY_MANIFEST','Open the complete original historical interval manifest.');
  return manifest;
}
async function verifyRetained(output,manifest){
  if(manifest.baseline)await verified(output,manifest.baseline);
  const seen=new Set();
  for(const attempt of manifest.attempts){
    if(attempt.request&&!seen.has(attempt.request.file)){await verified(output,attempt.request);seen.add(attempt.request.file);}
    if(attempt.response&&!seen.has(attempt.response.file)){await verified(output,attempt.response);seen.add(attempt.response.file);}
    if(attempt.exchangeFile&&!seen.has(attempt.exchangeFile.file)){await verified(output,attempt.exchangeFile);seen.add(attempt.exchangeFile.file);}
  }
  let next=BigInt(manifest.query.startLedger),previous=null;
  for(const page of manifest.pages){
    need(Array.isArray(page.ledgers)&&page.ledgers.length&&manifest.attempts.some(attempt=>attempt.id===page.exchangeId&&attempt.bodyComplete),
      'HISTORY_MANIFEST','Every accepted ledger page needs its complete original exchange.');
    for(const ledger of page.ledgers){
      need(BigInt(ledger.sequence)===next&&(!previous||ledger.previousLedgerHash===previous),'HISTORY_CHAIN','Retain the consecutive original ledger header chain.');
      need(HASH.test(ledger.hash)&&HASH.test(ledger.transactionIdentitySha256),'HISTORY_CHAIN','Retain each whole native ledger identity.');
      previous=ledger.hash;next++;
    }
  }
  need(String(next)===manifest.nextLedger&&previous===manifest.previousLedgerHash&&next<=BigInt(manifest.query.beforeLedger),
    'HISTORY_CHECKPOINT','The history checkpoint must follow its last fully retained original ledger.');
  return manifest;
}

async function writeBody(response,root,file){
  const handle=await open(join(root,file),'wx',0o600),hash=createHash('sha256');let bytes=0,complete=false;
  try{
    if(response.body&&response.body[Symbol.asyncIterator]){
      for await(const supplied of response.body){const chunk=Buffer.from(supplied);await handle.writeFile(chunk);hash.update(chunk);bytes+=chunk.length;}
    }else{const chunk=Buffer.from(await response.arrayBuffer());await handle.writeFile(chunk);hash.update(chunk);bytes=chunk.length;}
    await handle.sync();complete=true;
  }catch(error){error.originalResponse={file,bytes,sha256:hash.digest('hex'),bodyComplete:false};throw error;}
  finally{await handle.close();}
  return {file,bytes,sha256:hash.digest('hex'),bodyComplete:complete};
}
async function requestPage(ctx,params,phase){
  const id=randomUUID(),request={jsonrpc:'2.0',id:'history-'+id,method:'getLedgers',params};
  const requestContent=JSON.stringify(request),prefix='responses/'+id;
  const attempt={id,phase,url:ctx.manifest.query.rpcUrl,method:'POST',startedAt:now(),completedAt:null,status:null,
    request:await newFile(ctx.output,prefix+'.request.json',requestContent),response:null,bodyComplete:false,headers:{},outcome:'requesting'};
  ctx.manifest.attempts.push(attempt);await ctx.save();
  try{
    const signals=[ctx.options.signal,AbortSignal.timeout(ctx.options.timeoutMs??60000)].filter(Boolean);
    const response=await ctx.fetchImpl(attempt.url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
      body:requestContent,redirect:'error',signal:AbortSignal.any(signals)});
    attempt.status=String(response.status);
    for(const header of ['content-type','content-length','date','retry-after','etag']){
      const value=response.headers?.get?.(header);if(value!==null&&value!==undefined)attempt.headers[header]=value;
    }
    attempt.response=await writeBody(response,ctx.output,prefix+'.response.json');
    attempt.bodyComplete=true;attempt.completedAt=now();attempt.outcome='received';
    attempt.exchangeFile=await newFile(ctx.output,prefix+'.exchange.json',JSON.stringify(attempt,null,2)+'\n');
    await ctx.save();
    const content=utf8(await verified(ctx.output,attempt.response));
    if(!response.ok)throw Object.assign(new Error('Original archive RPC returned HTTP '+response.status+'.'),{
      code:'HISTORY_HTTP_'+response.status,status:response.status,retryAfter:attempt.headers['retry-after']??null});
    const document=parseNativeJSON(content);
    if(document?.error)throw Object.assign(new Error('Original archive RPC returned '+String(document.error.code)+': '+String(document.error.message)),{
      code:'HISTORY_RPC_ERROR',rpcCode:document.error.code,rpcMessage:document.error.message});
    const decoded=decodeArchiveLedgerPage({content,sdk:ctx.sdk,networkPassphrase:ctx.manifest.query.networkPassphrase,request});
    attempt.outcome='decoded';await ctx.save();
    return {attempt,request,requestContent,content,decoded,headers:ledgerHeaders(decoded)};
  }catch(error){
    if(error.originalResponse)attempt.response=error.originalResponse;
    attempt.completedAt=now();attempt.outcome='interrupted';
    attempt.failure={code:error.code||error.name||'HISTORY_ACQUISITION',message:error.message,rpcCode:error.rpcCode??null,retryAfter:error.retryAfter??null};
    if(!attempt.exchangeFile)attempt.exchangeFile=await newFile(ctx.output,prefix+'.exchange.json',JSON.stringify(attempt,null,2)+'\n');
    await ctx.save();throw error;
  }
}
function allHeaders(manifest){
  return new Map(manifest.pages.flatMap(page=>page.ledgers.map(ledger=>[ledger.sequence,{...ledger,exchangeId:page.exchangeId}])));
}
function uniqueMatches(rows){
  const index=new Map();
  for(const row of ordered(rows)){
    const prior=index.get(row.hash);
    if(prior)need(prior.ledger===row.ledger&&prior.applicationOrder===row.applicationOrder&&prior.ledgerHash===row.ledgerHash,
      'HISTORY_TRANSACTION_IDENTITY','The same original envelope has conflicting native ledger placement.');
    else index.set(row.hash,row);
  }
  return [...index.values()];
}
async function closeSelectedLedgers(ctx,rows,fetchClosures){
  const manifest=ctx.manifest,headers=allHeaders(manifest),ledgers=[...new Set(rows.map(row=>row.ledger))];
  manifest.closures??=[];
  for(const ledger of ledgers){
    const old=manifest.closures.find(item=>item.ledger===ledger);
    if(old||!fetchClosures)continue;
    const scan=manifest.pages.find(page=>page.ledgers.length===1&&page.ledgers[0].sequence===ledger);
    if(scan){manifest.closures.push({ledger,exchangeId:scan.exchangeId,header:scan.ledgers[0]});await ctx.save();continue;}
    const result=await requestPage(ctx,{startLedger:Number(ledger),pagination:{limit:1},xdrFormat:'base64'},'selected-ledger');
    need(result.headers.length===1&&result.headers[0].sequence===ledger,'HISTORY_SELECTED_LEDGER','The original selected-ledger response must contain that one complete ledger.');
    const expected=headers.get(ledger),actual=result.headers[0];
    need(expected&&actual.hash===expected.hash&&actual.transactionIdentitySha256===expected.transactionIdentitySha256,
      'HISTORY_SELECTED_SOURCE_CHANGED','The original selected ledger differs from its already retained scan header, envelope, result or metadata.');
    manifest.closures.push({ledger,exchangeId:result.attempt.id,header:actual});await ctx.save();
    await ctx.progress('selected-ledger',{ledger,closed:String(manifest.closures.length),matchedLedgers:String(ledgers.length)});
  }
}
async function selectionFiles(ctx,selection,rows,{fetchClosures}){
  const manifest=ctx.manifest,selected=uniqueMatches(rows);
  await closeSelectedLedgers(ctx,selected,fetchClosures);
  const selectionId=randomUUID(),directory='selections/'+selectionId;
  await mkdir(join(ctx.output,directory),{mode:0o700});
  const snapshot=JSON.stringify(manifest,null,2)+'\n';
  const intervalSnapshot=await newFile(ctx.output,directory+'/interval-snapshot.json',snapshot);
  const headers=allHeaders(manifest),attempts=new Map(manifest.attempts.map(item=>[item.id,item]));
  const sourceExchanges=new Map(),selectionRows=[];
  for(const row of selected){
    const closure=manifest.closures.find(item=>item.ledger===row.ledger),header=headers.get(row.ledger);
    const exchangeId=closure?.exchangeId||header.exchangeId,attempt=attempts.get(exchangeId);
    need(attempt?.bodyComplete,'HISTORY_SOURCE_CLOSURE','Every selected original transaction needs its complete retained ledger response.');
    sourceExchanges.set(exchangeId,{attempt,mode:closure?'original-one-ledger-response':'retained-whole-scan-page'});
    selectionRows.push({...row,selectedSourceFile:attempt.response.file,
      sourceClosure:closure?'original-one-ledger-response':'retained-whole-scan-page',
      selectedSourcePointer:closure?'#/result/ledgers/0/metadataXdr':row.sourcePointer,
      selectedHeaderPointer:closure?'#/result/ledgers/0/headerXdr':row.headerPointer});
  }
  const baseline=manifest.baseline?parseNativeJSON(utf8(await verified(ctx.output,manifest.baseline))):{};
  need(plain(baseline),'HISTORY_BASELINE','Retain the original capture option object.');
  const sources=[],sourceRecords=[];
  for(const {attempt,mode}of sourceExchanges.values()){
    const requestContent=utf8(await verified(ctx.output,attempt.request));
    const request=parseNativeJSON(requestContent),content=utf8(await verified(ctx.output,attempt.response));
    const original={format:'stellar-rpc-ledgers-json',sourceUrl:attempt.url,request,requestContent,content,
      status:attempt.status,retrievedAt:attempt.completedAt,
      acquisition:{transport:'native-public-rpc',operation:manifest.operation,sourceSelectionId:selectionId,
        requestStartedAt:attempt.startedAt,responseCompletedAt:attempt.completedAt,
        requestSha256:attempt.request.sha256,responseSha256:attempt.response.sha256,
        sourceClosure:mode,interval:{startLedger:manifest.query.startLedger,beforeLedger:manifest.query.beforeLedger},
        fullIntervalArchive:{manifest:relative(ctx.sourceRoot,join(ctx.output,intervalSnapshot.file)).split(String.fromCharCode(92)).join('/'),
          bytes:intervalSnapshot.bytes,sha256:intervalSnapshot.sha256,
          coverage:'The full original interval and every raw exchange remain in the native source archive. This editable source input retains the selected complete original response pages.'}}};
    sources.push(original);
    sourceRecords.push({exchangeId:attempt.id,sourceClosure:mode,request:attempt.request,response:attempt.response,
      sourceUrl:attempt.url,retrievedAt:attempt.completedAt});
  }
  const existing=baseline.originalLedgerSources||[];
  need(Array.isArray(existing),'HISTORY_BASELINE','Keep originalLedgerSources as whole retained source descriptors.');
  const sourceKey=value=>stable([value.format,value.sourceUrl,digest(value.requestContent||JSON.stringify(value.request??null)),digest(value.content)]);
  const originals=new Map();
  for(const source of [...existing,...sources]){
    need(plain(source)&&typeof source.content==='string'&&typeof source.sourceUrl==='string','HISTORY_BASELINE','Retain complete original source response strings.');
    originals.set(sourceKey(source),source);
  }
  const hashes=strings([...(baseline.transactionHashes||[]),...selectionRows.map(row=>row.hash)],'original transaction hashes');
  need(hashes.every(hash=>HASH.test(hash)),'HISTORY_TRANSACTION_HASH','Use exact original transaction hashes.');
  const captureOptions={...baseline,network:manifest.query.network,networkPassphrase:manifest.query.networkPassphrase,
    archiveRpcUrl:manifest.query.rpcUrl,accounts:selection.accounts,contractIds:selection.contractIds,
    transactionHashes:hashes,originalLedgerSources:[...originals.values()]};
  delete captureOptions.account;delete captureOptions.contractId;
  const optionRecord=await newFile(ctx.output,directory+'/capture-options.json',JSON.stringify(captureOptions,null,2)+'\n');
  const report={schema:SELECT_SCHEMA,id:selectionId,operation:manifest.operation,createdAt:now(),
    query:manifest.query,selection,intervalSnapshot,status:'complete',sourceClosure:fetchClosures?'original-one-ledger-responses':'existing-whole-original-responses',
    coverage:{scannedLedgers:String(BigInt(manifest.query.beforeLedger)-BigInt(manifest.query.startLedger)),
      decodedTransactions:manifest.decodedTransactions,matchedTransactions:String(selectionRows.length),
      matchedLedgers:String(new Set(selectionRows.map(row=>row.ledger)).size),
      originalPagesInEditableInput:String(sources.length),
      fullIntervalLocation:'Complete native source archive; every original scan response remains beside the retained interval manifest.',
      selectedRecordsBasis:selection.basis},
    selected:selectionRows,sourceResponses:sourceRecords,captureOptions:optionRecord,
    signedTransactions:selectionRows.filter(row=>selection.addresses.includes(row.baseSourceAccount)).map(row=>({
      hash:row.hash,ledger:row.ledger,applicationOrder:row.applicationOrder,createdAt:row.createdAt,
      sourceAccount:row.baseSourceAccount,sourceSequence:row.sourceSequence,successful:row.successful,
      bumpSequences:row.bumpSequences,nativeTransactionId:row.nativeTransactionId,
      sourceFile:row.selectedSourceFile,sourcePointer:row.selectedSourcePointer,nativeXdrPath:row.nativeXdrPath})),
  };
  const reportRecord=await newFile(ctx.output,directory+'/selection.json',JSON.stringify(report,null,2)+'\n');
  manifest.selections.push({id:selectionId,createdAt:report.createdAt,selection,manifest:reportRecord,captureOptions:optionRecord,
    matchedTransactions:report.coverage.matchedTransactions,matchedLedgers:report.coverage.matchedLedgers});
  manifest.latestSelectionId=selectionId;await ctx.save();
  await ctx.progress('selection-complete',{selectionId,selectedTransactions:report.coverage.matchedTransactions});
  return {output:ctx.output,manifest:join(ctx.output,'history.json'),selectionManifest:join(ctx.output,reportRecord.file),
    captureOptions:join(ctx.output,optionRecord.file),captureOptionsBytes:optionRecord.bytes,captureOptionsSha256:optionRecord.sha256,
    selectionId,query:manifest.query,scannedLedgers:report.coverage.scannedLedgers,decodedTransactions:manifest.decodedTransactions,
    selectedTransactions:selectionRows.length,selectedLedgers:Number(report.coverage.matchedLedgers),transactionHashes:hashes,
    fullOriginalPages:manifest.pages.length,selectedOriginalPages:sources.length};
}
async function context(options,state,sdk,manifest){
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  need(typeof fetchImpl==='function','HISTORY_FETCH','Use the existing native Node fetch runtime.');
  const ctx={options,...state,sdk,manifest,fetchImpl};
  ctx.save=async()=>{manifest.updatedAt=now();await atomic(join(state.output,'history.json'),manifest);};
  ctx.progress=async(phase,extra={})=>{
    if(options.onProgress)await options.onProgress({phase,...extra,manifest:join(state.output,'history.json'),nextLedger:manifest.nextLedger,
      retainedPages:String(manifest.pages.length),decodedTransactions:manifest.decodedTransactions});
  };
  return ctx;
}

async function completedSelection(ctx,entry){
  const report=JSON.parse(utf8(await verified(ctx.output,entry.manifest)));
  await verified(ctx.output,entry.captureOptions);await verified(ctx.output,report.intervalSnapshot);
  need(report.schema===SELECT_SCHEMA&&report.id===entry.id&&report.status==='complete','HISTORY_SELECTION','Retain the complete saved historical selection.');
  const input=parseNativeJSON(utf8(await verified(ctx.output,entry.captureOptions)));
  return {output:ctx.output,manifest:join(ctx.output,'history.json'),selectionManifest:join(ctx.output,entry.manifest.file),
    captureOptions:join(ctx.output,entry.captureOptions.file),captureOptionsBytes:entry.captureOptions.bytes,captureOptionsSha256:entry.captureOptions.sha256,
    selectionId:entry.id,query:ctx.manifest.query,scannedLedgers:report.coverage.scannedLedgers,
    decodedTransactions:report.coverage.decodedTransactions,selectedTransactions:Number(report.coverage.matchedTransactions),
    selectedLedgers:Number(report.coverage.matchedLedgers),transactionHashes:input.transactionHashes,
    fullOriginalPages:ctx.manifest.pages.length,selectedOriginalPages:report.sourceResponses.length,replayed:true};
}

/**
 * Acquire EVERY ledger in [startLedger,beforeLedger), retaining complete original
 * POST request/response files and native header/application identities.
 * Resume uses only the same provider cursor, query and initial source selection.
 * Selected ledgers are fetched as complete original limit=1 responses before a
 * compact capture-options file is produced for the normal GiveCredit collector.
 */
export async function captureLedgerInterval(options={}){
  const sdk=await nativeSDK(options);let prepared;
  if(!options.resume){
    const baseline=await loadBaseline(options),query=queryOf(options,baseline.value),selection=selectedAddresses(sdk,options,baseline.value);
    need(sdk.Networks?.[query.network==='mainnet'?'PUBLIC':'TESTNET']===query.networkPassphrase,
      'HISTORY_NETWORK','Use the original selected native network passphrase.');
    prepared={baseline,query,selection};
  }
  const state=await workspace(options,!options.resume);let ctx;
  try{
    let manifest,baseline,query,selection;
    if(options.resume){
      manifest=await verifyRetained(state.output,await loadManifest(state.output));
      baseline=manifest.baseline?{value:parseNativeJSON(utf8(await verified(state.output,manifest.baseline)))}:{value:{}};
      query=queryOf({...manifest.query,...defined(options)},baseline.value);
      selection=selectedAddresses(sdk,selectionOptions(manifest.initialSelection,options),baseline.value);
      need(stable(query)===stable(manifest.query)&&stable(selection)===stable(manifest.initialSelection),
        'HISTORY_RESUME_SELECTION','Resume the same archive, ledger interval, page size, network and initial source addresses. Use offline re-selection for a new address selection.');
      if(options.baselineOptionsFile){
        const supplied=await loadBaseline(options);
        need(manifest.baseline&&digest(supplied.raw)===manifest.baseline.sha256,'HISTORY_RESUME_BASELINE','Resume with the same original baseline capture options.');
      }
      if(options.operation)need(options.operation===manifest.operation,'HISTORY_OPERATION','Resume the original native operation.');
    }else{
      ({baseline,query,selection}=prepared);
      manifest={schema:SCHEMA,operation:options.operation||'SCF-CARBON-NATIVE-8D45-20261012',
        createdAt:now(),updatedAt:now(),createdIn:{sourceRoot:state.sourceRoot,outputDirectory:state.output,hostname:hostname()},
        query,initialSelection:selection,status:'scanning',phase:'scan',baseline:null,
        coverage:'Every complete original ledger in the explicit half-open interval, with original RPC request/response bytes, native header chain, transaction envelopes, results and application metadata.',
        nextLedger:query.startLedger,cursor:null,previousLedgerHash:null,decodedTransactions:'0',
        pages:[],attempts:[],closures:[],selections:[],latestSelectionId:null};
      if(baseline.raw)manifest.baseline=await newFile(state.output,'baseline-capture-options.json',baseline.raw);
    }
    need(sdk.Networks?.[query.network==='mainnet'?'PUBLIC':'TESTNET']===query.networkPassphrase,
      'HISTORY_NETWORK','The selected passphrase must match the original named Stellar network.');
    manifest.runtime={sourceRoot:state.sourceRoot,outputDirectory:state.output,hostname:hostname(),openedAt:now()};
    ctx=await context(options,state,sdk,manifest);
    const existing=[...manifest.selections].reverse().find(item=>stable(item.selection)===stable(manifest.initialSelection));
    if(existing&&manifest.nextLedger===query.beforeLedger&&manifest.scanCompletedAt){
      const result=await completedSelection(ctx,existing);manifest.status='complete';manifest.phase='complete';
      manifest.completedAt??=now();delete manifest.interruption;await ctx.save();return result;
    }
    manifest.status='scanning';manifest.phase='scan';delete manifest.interruption;await ctx.save();
    while(BigInt(manifest.nextLedger)<BigInt(query.beforeLedger)){
      if(options.signal?.aborted)throw Object.assign(new Error('Original historical capture was paused.'),{code:'HISTORY_PAUSED'});
      const limit=Number(BigInt(query.beforeLedger)-BigInt(manifest.nextLedger)<BigInt(query.pageSize)?
        BigInt(query.beforeLedger)-BigInt(manifest.nextLedger):BigInt(query.pageSize));
      const pagination={limit};if(manifest.cursor!==null)pagination.cursor=manifest.cursor;
      const params={pagination,xdrFormat:'base64'};if(manifest.cursor===null)params.startLedger=Number(manifest.nextLedger);
      const result=await requestPage(ctx,params,'scan');
      need(result.headers.length>0&&result.headers.length<=limit,'HISTORY_PAGE_MEMBERSHIP','The original archive must return a nonempty complete page within its requested limit until the interval ends.');
      let expected=BigInt(manifest.nextLedger),previous=manifest.previousLedgerHash;
      for(const ledger of result.headers){
        need(BigInt(ledger.sequence)===expected&&expected<BigInt(query.beforeLedger),
          'HISTORY_LEDGER_GAP','The original archive returned an omitted, repeated or out-of-range ledger; retain the exchange and resume the same selection.');
        need(!previous||ledger.previousLedgerHash===previous,'HISTORY_HEADER_CHAIN','The consecutive original ledger headers do not form the same native chain.');
        previous=ledger.hash;expected++;
      }
      const cursor=result.decoded.cursor,more=expected<BigInt(query.beforeLedger);
      if(more)need(typeof cursor==='string'&&cursor.length&&cursor!==manifest.cursor&&!manifest.pages.some(page=>page.cursor===cursor),
        'HISTORY_CURSOR','Continue only with the provider original advancing opaque ledger cursor.');
      const selected=matches(result.decoded,selection,result.attempt);
      manifest.pages.push({exchangeId:result.attempt.id,requestCursor:manifest.cursor,cursor,
        firstLedger:result.headers[0].sequence,lastLedger:result.headers.at(-1).sequence,
        ledgers:result.headers,decodedTransactions:String(result.decoded.rows.length),matches:selected});
      manifest.nextLedger=String(expected);manifest.previousLedgerHash=previous;manifest.cursor=cursor;
      manifest.decodedTransactions=(BigInt(manifest.decodedTransactions)+BigInt(result.decoded.rows.length)).toString();
      await ctx.save();await ctx.progress('scan-page',{firstLedger:result.headers[0].sequence,lastLedger:result.headers.at(-1).sequence,
        selectedTransactions:String(manifest.pages.reduce((sum,page)=>sum+page.matches.length,0))});
    }
    manifest.scanCompletedAt??=now();manifest.status='scan-complete';manifest.phase='selected-source-closure';await ctx.save();
    const result=await selectionFiles(ctx,selection,manifest.pages.flatMap(page=>page.matches),{fetchClosures:true});
    manifest.status='complete';manifest.phase='complete';manifest.completedAt=now();delete manifest.interruption;await ctx.save();
    return result;
  }catch(error){
    if(ctx){ctx.manifest.status='interrupted';ctx.manifest.interruption={at:now(),code:error.code||error.name||'HISTORY_CAPTURE',message:error.message,
      rpcCode:error.rpcCode??null,retryAfter:error.retryAfter??null};await ctx.save();error.checkpoint=join(state.output,'history.json');}
    throw error;
  }finally{await state.release();}
}

/**
 * Re-select a completed interval from its whole original local pages.
 * By default this performs no network requests. It reuses any already acquired
 * one-ledger originals, otherwise includes the existing full matched scan pages.
 * fetchClosures:true acquires original limit=1 responses for newly matched ledgers.
 */
export async function selectLedgerInterval(options={}){
  const sdk=await nativeSDK(options),state=await workspace(options,false);let ctx;
  try{
    const manifest=await verifyRetained(state.output,await loadManifest(state.output));
    need(manifest.scanCompletedAt&&manifest.nextLedger===manifest.query.beforeLedger,'HISTORY_SCAN_REQUIRED','Complete or resume the retained whole interval before selecting additional source addresses.');
    need(!options.rpcUrl||endpoint(options.rpcUrl)===manifest.query.rpcUrl,'HISTORY_RESELECT_PROVIDER','Re-select from the original archive provider and retained interval.');
    const baseline=manifest.baseline?parseNativeJSON(utf8(await verified(state.output,manifest.baseline))):{};
    const selection=selectedAddresses(sdk,selectionOptions(manifest.initialSelection,options),baseline);
    need(sdk.Networks?.[manifest.query.network==='mainnet'?'PUBLIC':'TESTNET']===manifest.query.networkPassphrase,
      'HISTORY_NETWORK','Use the native SDK on the retained original network.');
    ctx=await context(options,state,sdk,manifest);
    const attempts=new Map(manifest.attempts.map(item=>[item.id,item])),selected=[];
    for(const [index,page]of manifest.pages.entries()){
      if(options.signal?.aborted)throw Object.assign(new Error('Historical source re-selection was paused.'),{code:'HISTORY_PAUSED'});
      const attempt=attempts.get(page.exchangeId),content=utf8(await verified(state.output,attempt.response));
      const request=parseNativeJSON(utf8(await verified(state.output,attempt.request)));
      const decoded=decodeArchiveLedgerPage({content,sdk,networkPassphrase:manifest.query.networkPassphrase,request});
      need(stable(ledgerHeaders(decoded))===stable(page.ledgers),'HISTORY_NATIVE_SOURCE_CHANGED','The original native ledger decoding differs from the retained complete scan.');
      selected.push(...matches(decoded,selection,attempt));
      await ctx.progress('reselect-page',{page:String(index+1),selectedTransactions:String(selected.length)});
    }
    const result=await selectionFiles(ctx,selection,selected,{fetchClosures:options.fetchClosures===true});
    manifest.status='complete';manifest.phase='complete';delete manifest.interruption;await ctx.save();return result;
  }catch(error){
    if(ctx){ctx.manifest.phase='selection-interrupted';ctx.manifest.interruption={at:now(),code:error.code||error.name||'HISTORY_RESELECT',message:error.message};
      await ctx.save();error.checkpoint=join(state.output,'history.json');}
    throw error;
  }finally{await state.release();}
}

/**
 * Complete original RPC closure for a native-selected ledger list. This composes
 * single-ledger intervals, retaining their original exchanges and the selecting
 * native source file. It does not repeat an already completed background scan.
 */
export async function captureLedgerSelection(options={}){
  const sdk=await nativeSDK(options);let prepared;
  if(!options.resume){
    const baseline=await loadBaseline(options);
    const ledgers=strings((options.ledgers||[]).map(value=>integer(value,'selected ledger')),'selected ledgers').sort((a,b)=>Number(a)-Number(b));
    need(ledgers.length,'HISTORY_SELECTED_LEDGERS','Provide the actual ledgers selected by the original native source.');
    const whole=queryOf({...options,startLedger:ledgers[0],beforeLedger:(BigInt(ledgers.at(-1))+1n).toString(),pageSize:1},baseline.value);
    const query={network:whole.network,networkPassphrase:whole.networkPassphrase,rpcUrl:whole.rpcUrl,ledgers};
    const selection=selectedAddresses(sdk,options,baseline.value);
    need(sdk.Networks?.[query.network==='mainnet'?'PUBLIC':'TESTNET']===query.networkPassphrase,'HISTORY_NETWORK','Use the original selected network.');
    const selectionRaw=options.sourceSelectionFile?await readFile(resolve(options.sourceSelectionFile)):null;
    if(selectionRaw)utf8(selectionRaw);
    prepared={baseline,query,selection,selectionRaw};
  }
  const state=await workspace(options,!options.resume);let manifest;
  const save=async()=>{manifest.updatedAt=now();await atomic(join(state.output,'selected-ledgers.json'),manifest);};
  try{
    if(options.resume){
      manifest=JSON.parse(utf8(await stored(state.output,'selected-ledgers.json')));
      need(manifest.schema==='stellar-forge.givecredit-selected-ledgers.v1','HISTORY_SELECTED_MANIFEST','Resume the original selected-ledger source closure.');
      if(manifest.baseline)await verified(state.output,manifest.baseline);
      if(manifest.selectionSource)await verified(state.output,manifest.selectionSource);
      const baseline=manifest.baseline?parseNativeJSON(utf8(await verified(state.output,manifest.baseline))):{};
      const selector=selectedAddresses(sdk,selectionOptions(manifest.selection,options),baseline);
      const ledgers=options.ledgers?strings(options.ledgers.map(value=>integer(value,'selected ledger')),'selected ledgers').sort((a,b)=>Number(a)-Number(b)):manifest.query.ledgers;
      need(stable(selector)===stable(manifest.selection)&&stable(ledgers)===stable(manifest.query.ledgers),
        'HISTORY_SELECTED_RESUME','Resume the same native-selected ledgers and source addresses.');
      if(options.rpcUrl)need(endpoint(options.rpcUrl)===manifest.query.rpcUrl,'HISTORY_SELECTED_RESUME','Resume the original archive provider.');
      if(options.network)need(options.network===manifest.query.network,'HISTORY_SELECTED_RESUME','Resume the original ledger network.');
      if(options.networkPassphrase)need(options.networkPassphrase===manifest.query.networkPassphrase,'HISTORY_SELECTED_RESUME','Retain the original network passphrase.');
      if(options.baselineOptionsFile)need(manifest.baseline&&digest((await loadBaseline(options)).raw)===manifest.baseline.sha256,
        'HISTORY_SELECTED_RESUME','Resume with the same original baseline capture options.');
      if(options.sourceSelectionFile)need(manifest.selectionSource&&digest(await readFile(resolve(options.sourceSelectionFile)))===manifest.selectionSource.sha256,
        'HISTORY_SELECTED_RESUME','Retain the same original native selection source file.');
    }else{
      manifest={schema:'stellar-forge.givecredit-selected-ledgers.v1',operation:options.operation||'SCF-CARBON-NATIVE-8D45-20261012',
        createdAt:now(),updatedAt:now(),status:'capturing',query:prepared.query,selection:prepared.selection,
        coverage:'The explicitly selected complete original ledgers. The native source file records their selection; any background checkpoint scan retains its separate full source scope.',
        baseline:null,selectionSource:null,children:[],captureOptions:null};
      await mkdir(join(state.output,'ledgers'),{mode:0o700});
      if(prepared.baseline.raw)manifest.baseline=await newFile(state.output,'baseline-capture-options.json',prepared.baseline.raw);
      if(prepared.selectionRaw)manifest.selectionSource=await newFile(state.output,'native-selection-source.json',prepared.selectionRaw);
    }
    manifest.status='capturing';delete manifest.interruption;await save();
    let baselinePath=manifest.baseline?join(state.output,manifest.baseline.file):undefined,last;
    for(const ledger of manifest.query.ledgers){
      const output=join(state.output,'ledgers',ledger);let exists=false;
      try{exists=(await lstat(output)).isDirectory();}catch(error){if(error.code!=='ENOENT')throw error;}
      const childOptions={...options,sourceRoot:state.sourceRoot,output,resume:exists,operation:manifest.operation,
        network:manifest.query.network,networkPassphrase:manifest.query.networkPassphrase,rpcUrl:manifest.query.rpcUrl,
        accounts:manifest.selection.accounts,contractIds:manifest.selection.contractIds,addresses:manifest.selection.additionalAddresses,
        startLedger:ledger,beforeLedger:(BigInt(ledger)+1n).toString(),pageSize:1,baselineOptionsFile:baselinePath,sdk,
        onProgress:options.onProgress?async progress=>options.onProgress({...progress,selectedLedger:ledger,selectedLedgerManifest:join(state.output,'selected-ledgers.json')}):undefined};
      last=await captureLedgerInterval(childOptions);
      baselinePath=last.captureOptions;
      const file=relative(state.output,last.captureOptions).split(String.fromCharCode(92)).join('/');
      const child={ledger,manifest:relative(state.output,last.manifest).split(String.fromCharCode(92)).join('/'),
        selectionManifest:relative(state.output,last.selectionManifest).split(String.fromCharCode(92)).join('/'),
        captureOptions:{file,bytes:last.captureOptionsBytes,sha256:last.captureOptionsSha256},
        decodedTransactions:last.decodedTransactions,selectedTransactions:last.selectedTransactions};
      const index=manifest.children.findIndex(value=>value.ledger===ledger);
      if(index<0)manifest.children.push(child);else manifest.children[index]=child;
      manifest.captureOptions=child.captureOptions;await save();
    }
    need(last&&manifest.captureOptions,'HISTORY_SELECTED_LEDGERS','Retain at least one complete selected original ledger.');
    await verified(state.output,manifest.captureOptions);
    manifest.status='complete';manifest.completedAt??=now();delete manifest.interruption;await save();
    return {output:state.output,manifest:join(state.output,'selected-ledgers.json'),
      captureOptions:join(state.output,manifest.captureOptions.file),captureOptionsBytes:manifest.captureOptions.bytes,
      captureOptionsSha256:manifest.captureOptions.sha256,query:manifest.query,
      selectedLedgers:manifest.query.ledgers.length,selectedTransactions:manifest.children.reduce((sum,row)=>sum+row.selectedTransactions,0),
      transactionHashes:last.transactionHashes,children:manifest.children};
  }catch(error){
    if(manifest){manifest.status='interrupted';manifest.interruption={at:now(),code:error.code||error.name||'HISTORY_SELECTED_CAPTURE',message:error.message};await save();
      error.checkpoint=join(state.output,'selected-ledgers.json');}throw error;
  }finally{await state.release();}
}
