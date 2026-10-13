// MIT. Native original Stellar RPC ledger decoding; no RPC calls or transactions.
import {createHash} from 'node:crypto';
import {need,plain,parseNativeJSON} from './source.mjs';

const HASH=/^[a-f0-9]{64}$/i;
const get=(object,key)=>typeof object?.[key]==='function'?object[key]():object?.[key];
const value=object=>typeof object?.value==='function'?object.value():object;
const variant=object=>{const tag=get(object,'switch');return tag?.name??String(tag);};
const hex=bytes=>Buffer.from(bytes).toString('hex');
const xdr=value=>value.toXDR('base64');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function sequence(input,label='ledger sequence'){
  need(input!==null&&input!==undefined&&/^[1-9]\d*$/.test(String(input)),'ARCHIVE_SEQUENCE','Keep the original '+label+'.');
  const n=BigInt(input);need(n<4294967296n,'ARCHIVE_SEQUENCE','The original '+label+' must fit a native uint32.');
  return n.toString();
}
function timestamp(input){
  need(input!==null&&input!==undefined&&/^\d+$/.test(String(input)),'ARCHIVE_TIMESTAMP','Keep the original native ledger close time.');
  const ms=BigInt(input)*1000n;need(ms<=8640000000000000n,'ARCHIVE_TIMESTAMP','The native ledger close time is outside the civil range.');
  return new Date(Number(ms)).toISOString();
}
function decode(Type,encoded,label){
  need(typeof encoded==='string'&&encoded.length>0&&typeof Type?.fromXDR==='function','ARCHIVE_XDR','Retain the complete '+label+' and its native SDK reader.');
  const parsed=Type.fromXDR(encoded,'base64');
  need(xdr(parsed)===encoded,'ARCHIVE_XDR_BYTES','The original '+label+' must retain its exact canonical base64 XDR bytes.');
  return parsed;
}
function nativeAccount(sdk,address){
  if(typeof address!=='string')return null;
  try{
    if(address.startsWith('M')&&sdk.MuxedAccount?.fromAddress)return sdk.MuxedAccount.fromAddress(address,'0').baseAccount().accountId();
    if(address.startsWith('G')){sdk.StrKey.decodeEd25519PublicKey(address);return address;}
    if(address.startsWith('C')){sdk.StrKey.decodeContract(address);return address;}
  }catch{}
  return null;
}
function collectStrings(sdk,input,addresses){
  if(typeof input==='string'){
    const address=nativeAccount(sdk,input);if(address)addresses.add(address);
  }else if(Array.isArray(input))for(const item of input)collectStrings(sdk,item,addresses);
  else if(input instanceof Map)for(const [key,item]of input){collectStrings(sdk,key,addresses);collectStrings(sdk,item,addresses);}
  else if(plain(input))for(const item of Object.values(input))collectStrings(sdk,item,addresses);
}
function envelopeDetails(sdk,parsed){
  const tx=parsed.innerTransaction||parsed,addresses=new Set(),calls=[],bumpSequences=[];
  collectStrings(sdk,tx.source,addresses);collectStrings(sdk,parsed.feeSource,addresses);
  for(const [index,op]of tx.operations.entries()){
    for(const field of ['source','destination','from','funder','sponsoredId','trustor','into','account','sponsor'])
      collectStrings(sdk,op[field],addresses);
    if(op.type==='bumpSequence'){
      need(op.bumpTo!==undefined&&/^-?\d+$/.test(String(op.bumpTo)),'ARCHIVE_BUMP_SEQUENCE','Keep the original bumpSequence target.');
      bumpSequences.push({operationIndex:String(index),sourceAccount:nativeAccount(sdk,op.source||tx.source),bumpTo:String(op.bumpTo)});
    }
    if(op.type==='invokeHostFunction'&&variant(op.func)==='hostFunctionTypeInvokeContract'){
      const call=get(op.func,'invokeContract')||value(op.func),address=sdk.Address.fromScAddress(get(call,'contractAddress')).toString();
      addresses.add(address);
      const args=get(call,'args')||[];for(const arg of args)collectStrings(sdk,sdk.scValToNative(arg),addresses);
      calls.push({operationIndex:String(index),contractId:address,function:Buffer.from(get(call,'functionName')).toString('utf8')});
    }
  }
  need(/^\d+$/.test(String(tx.sequence)),'ARCHIVE_TRANSACTION_SEQUENCE','Keep the original signed account sequence.');
  return {addresses:[...addresses],sourceAccount:tx.source,baseSourceAccount:nativeAccount(sdk,tx.source),
    sourceSequence:String(tx.sequence),feeSource:parsed.feeSource||null,operationKinds:tx.operations.map(op=>op.type),
    contractCalls:calls,bumpSequences,feeBump:Boolean(parsed.innerTransaction)};
}
function envelopesOf(set){
  const result=[],seen=new Set();
  const visit=item=>{
    if(!item)return;
    if(Array.isArray(item)){for(const child of item)visit(child);return;}
    if(seen.has(item))return;seen.add(item);
    if(['envelopeTypeTxV0','envelopeTypeTx','envelopeTypeTxFeeBump'].includes(variant(item))){result.push(item);return;}
    const active=value(item);if(active!==item){visit(active);return;}
    // Exact fields from TransactionSet, TransactionSetV1 and ParallelTxsComponent.
    for(const field of ['txs','phases','executionStages'])if(typeof item[field]==='function')visit(item[field]());
  };
  visit(set);return result;
}
function resultInfo(result,aliases){
  const union=get(result,'result'),tag=variant(union);
  let inner=union;
  if(['txFeeBumpInnerSuccess','txFeeBumpInnerFailed'].includes(tag)){
    const pair=get(union,'innerResultPair')||value(union),innerHash=hex(get(pair,'transactionHash'));
    need(aliases.includes(innerHash),'ARCHIVE_INNER_HASH','The original fee-bump result belongs to a different inner transaction.');
    inner=get(get(pair,'result'),'result');
  }
  const successful=tag==='txSuccess'||tag==='txFeeBumpInnerSuccess';
  need(!successful||variant(inner)==='txSuccess','ARCHIVE_RESULT','Keep consistent original inner and outer transaction results.');
  return {successful,resultCode:tag};
}

/**
 * Decode one COMPLETE original JSON-RPC getLedgers response.
 * Return normalized original transaction rows, exact source JSON pointers and
 * ledger header identities. Transaction order comes from txProcessing, not txSet.
 * The caller retains content unchanged; this function creates no source response.
 */
export function decodeArchiveLedgerPage({content,sdk,networkPassphrase,request}={}){
  need(typeof content==='string'&&typeof networkPassphrase==='string'&&networkPassphrase.length,
    'ARCHIVE_SOURCE','Provide the complete original RPC response and selected network passphrase.');
  need(sdk?.xdr?.LedgerCloseMeta&&sdk?.xdr?.LedgerHeaderHistoryEntry&&sdk?.TransactionBuilder,
    'ARCHIVE_SDK','Use the existing native Stellar SDK with ledger and transaction XDR readers.');
  const response=parseNativeJSON(content);
  need(plain(response)&&response.jsonrpc==='2.0'&&response.error===undefined&&plain(response.result)&&Array.isArray(response.result.ledgers),
    'ARCHIVE_RPC_RESPONSE','Retain the original successful JSON-RPC getLedgers response.');
  if(request){
    need(plain(request)&&request.jsonrpc==='2.0'&&request.method==='getLedgers'&&plain(request.params),
      'ARCHIVE_RPC_REQUEST','Retain the original getLedgers request.');
    need(request.params.xdrFormat===undefined||request.params.xdrFormat==='base64','ARCHIVE_RPC_FORMAT','Acquire the original base64 XDR form.');
    need(String(response.id)===String(request.id),'ARCHIVE_RPC_ID','The original RPC response must match its retained request.');
  }
  const rows=[],ledgers=[],seenLedgers=new Set();
  for(const [ledgerIndex,record]of response.result.ledgers.entries()){
    need(plain(record),'ARCHIVE_LEDGER','Retain each original RPC ledger record.');
    const ledger=sequence(record.sequence),prefix='#/result/ledgers/'+ledgerIndex;
    need(!seenLedgers.has(ledger),'ARCHIVE_REPEATED_LEDGER','The provider repeated a ledger within one response.');
    seenLedgers.add(ledger);
    const close=decode(sdk.xdr.LedgerCloseMeta,record.metadataXdr,'ledger close metadata'),body=value(close);
    const history=get(body,'ledgerHeader'),header=get(history,'header'),headerHash=hex(get(history,'hash'));
    need(header&&HASH.test(headerHash)&&sha(header.toXDR())===headerHash,'ARCHIVE_HEADER_HASH','The original ledger header hash does not match its native bytes.');
    need(String(get(header,'ledgerSeq'))===ledger,'ARCHIVE_HEADER_SEQUENCE','The native ledger metadata and response sequence disagree.');
    need(typeof record.hash==='string'&&record.hash.toLowerCase()===headerHash,'ARCHIVE_REPORTED_HASH','The original reported ledger hash differs from its native header.');
    const headerHistory=decode(sdk.xdr.LedgerHeaderHistoryEntry,record.headerXdr,'ledger header');
    need(xdr(headerHistory)===xdr(history),'ARCHIVE_HEADER_METADATA','The original header and close metadata describe different ledgers.');
    const closeSeconds=String(get(get(header,'scpValue'),'closeTime'));
    need(String(record.ledgerCloseTime)===closeSeconds,'ARCHIVE_CLOSE_TIME','The native and reported ledger close timestamps disagree.');
    const createdAt=timestamp(closeSeconds),previousLedgerHash=hex(get(header,'previousLedgerHash'));
    const protocol=String(get(header,'ledgerVersion')),envelopes=envelopesOf(get(body,'txSet'));
    const processing=get(body,'txProcessing');
    need(Array.isArray(processing)&&envelopes.length===processing.length,'ARCHIVE_TRANSACTION_SET','The native transaction set and application results must have the same complete membership.');
    const canonical=new Map(),aliasIndex=new Map();
    for(const envelope of envelopes){
      const encoded=xdr(envelope),parsed=sdk.TransactionBuilder.fromXDR(encoded,networkPassphrase);
      const hash=hex(parsed.hash()),aliases=[...new Set([hash,...(parsed.innerTransaction?[hex(parsed.innerTransaction.hash())]:[])])];
      need(!canonical.has(hash),'ARCHIVE_DUPLICATE_ENVELOPE','The original transaction set repeats an envelope.');
      const item={encoded,parsed,hash,aliases};canonical.set(hash,item);
      for(const alias of aliases){const list=aliasIndex.get(alias)||[];list.push(item);aliasIndex.set(alias,list);}
    }
    const applied=new Set();
    for(const [ordinal,entry]of processing.entries()){
      const pair=get(entry,'result'),nativeHash=hex(get(pair,'transactionHash')),exact=canonical.get(nativeHash);
      const options=exact?[exact]:(aliasIndex.get(nativeHash)||[]);
      need(options.length===1,'ARCHIVE_ENVELOPE_RESULT_JOIN','Each native transaction result must identify exactly one original envelope.');
      const item=options[0];need(!applied.has(item.hash),'ARCHIVE_REPEATED_RESULT','The original ledger repeats a transaction application result.');applied.add(item.hash);
      const result=get(pair,'result'),meta=get(entry,'txApplyProcessing');
      need(result&&meta,'ARCHIVE_TRANSACTION_METADATA','Retain the original transaction result and complete application metadata.');
      const resultStatus=resultInfo(result,item.aliases),details=envelopeDetails(sdk,item.parsed);
      const applicationOrder=String(ordinal+1),nativeTransactionId=((BigInt(ledger)<<32n)|(BigInt(applicationOrder)<<12n)).toString();
      need(BigInt(applicationOrder)<1048576n,'ARCHIVE_APPLICATION_ORDER','The native application position must fit the transaction identifier.');
      rows.push({hash:item.hash,hashAliases:item.aliases,ledger,createdAt,applicationOrder,nativeTransactionId,
        originalProtocol:protocol,envelopeXdr:item.encoded,resultXdr:xdr(result),resultMetaXdr:xdr(meta),
        ...resultStatus,...details,sourcePointer:prefix+'/metadataXdr',headerPointer:prefix+'/headerXdr',
        nativeXdrPath:'v'+String(get(close,'switch'))+'.txProcessing['+ordinal+']',ledgerHash:headerHash});
    }
    need(applied.size===canonical.size,'ARCHIVE_UNAPPLIED_ENVELOPE','Every retained native envelope needs its original application result.');
    ledgers.push({sequence:ledger,hash:headerHash,previousLedgerHash,createdAt,ledgerCloseTime:closeSeconds,
      protocol,transactions:String(processing.length),sourcePointer:prefix});
  }
  return {responseId:response.id,cursor:response.result.cursor??null,
    oldestLedger:response.result.oldestLedger===undefined?null:String(response.result.oldestLedger),
    latestLedger:response.result.latestLedger===undefined?null:String(response.result.latestLedger),ledgers,rows};
}
