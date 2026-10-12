// MIT. Decode original ElementPay v1/v2 events with the retained native ethers runtime.
import {promises as fs} from 'node:fs';
import {sha256,need,object,canonicalHash,integerText} from './lossless-json.mjs';
const EVENTS=['OrderCreated','OrderSettled','OrderRefunded'];
const ABI_SHA256='4bb62009ea0cfefea6a2e56b5bc6d0d5c9ff079dc1f7a61d7fba31ada0c9dcf7';
const LEGACY_SHA256='909b2479a5888277feb08b790b2547ccf71957882362423203151d93ec4fca61';
const LEGACY_INTERFACE_SHA256='7fbb4c26b56867fb57b5f83d04409631daf150d3d38620716f7e6c27d744a01a';
const ELEMENTFLOW_COMMIT='834400cfead38c338917f1fbc9654dbb3f6093ce';
// The standard's original declaration: https://eips.ethereum.org/EIPS/eip-20#transfer-1
const TRANSFER_ABI='event Transfer(address indexed _from,address indexed _to,uint256 _value)';
export const INVOICE_EVENT_PROFILES=Object.freeze(['all','listener-v2','elementflow-v1']);
let originalABIs;
async function abis(){
  if(!originalABIs)originalABIs=(async()=>{
    const listener=JSON.parse(await fs.readFile(new URL('./source/elementpay-listener.json',import.meta.url),'utf8'));
    const file=listener.files.find(item=>item.path==='abi.json');
    need(file&&sha256(Buffer.from(file.content,'utf8'))===ABI_SHA256,'ORIGINAL_ABI_CHANGED','The original listener ABI differs from its retained source.');
    const modern=JSON.parse(file.content),created=modern.find(item=>item.type==='event'&&item.name==='OrderCreated');
    need(created,'ORIGINAL_ABI_CHANGED','The original OrderCreated fragment is missing.');
    const contracts=JSON.parse(await fs.readFile(new URL('./source/elementflow-contracts.json',import.meta.url),'utf8'));
    need(contracts.publisher?.repository==='elementpayHQ/ElementFlow'&&contracts.publisher?.commit===ELEMENTFLOW_COMMIT,
      'ORIGINAL_ABI_CHANGED','Select the retained original ElementFlow source generation.');
    const legacy=contracts.files.find(item=>item.path==='contracts/legacy/OrderManagementV1.sol');
    const nativeInterface=contracts.files.find(item=>item.path==='contracts/interfaces/IOrderManagement.sol');
    need(legacy&&sha256(Buffer.from(legacy.content))===LEGACY_SHA256&&nativeInterface&&sha256(Buffer.from(nativeInterface.content))===LEGACY_INTERFACE_SHA256,
      'ORIGINAL_ABI_CHANGED','The original legacy event and order-type declarations differ.');
    const code=legacy.content.replace(/\s+/g,''),types=nativeInterface.content.replace(/\s+/g,'');
    need(code.includes('eventOrderSettled(bytes32indexedorderId);')&&code.includes('eventOrderRefunded(bytes32indexedorderId);')&&
      types.includes('enumOrderType{OnRamp,OffRamp}'),'ORIGINAL_ABI_CHANGED','The retained legacy contract declarations differ.');
    const v1=[created,...['OrderSettled','OrderRefunded'].map(name=>({anonymous:false,name,type:'event',
      inputs:[{indexed:true,internalType:'bytes32',name:'orderId',type:'bytes32'}]}))];
    return {modern,v1};
  })();
  return originalABIs;
}
export async function invoiceInterface(runtime={}, {eventProfile='all'}={}){
  need(INVOICE_EVENT_PROFILES.includes(eventProfile),'INVALID_EVENT_PROFILE','Select all, listener-v2 or elementflow-v1.');
  const {loadInvoiceEthers}=await import('./runtime.mjs'),loaded=await loadInvoiceEthers(runtime??{});
  need(loaded.ethers?.version==='6.13.5'&&typeof loaded.ethers.Interface==='function','SDK_VERSION_MISMATCH','Use the retained original ethers 6.13.5 interface.');
  const original=await abis(),profiles=[];
  if(eventProfile!=='elementflow-v1')profiles.push({id:'listener-v2',interface:new loaded.ethers.Interface(original.modern),
    source:{repository:'elementpayHQ/element-pay-listener',commit:'5aa0f8db98fc348da4a6186d9299b21abe401201',path:'abi.json',sha256:ABI_SHA256}});
  if(eventProfile!=='listener-v2')profiles.push({id:'elementflow-v1',interface:new loaded.ethers.Interface(original.v1),
    source:{repository:'elementpayHQ/ElementFlow',commit:ELEMENTFLOW_COMMIT,path:'contracts/legacy/OrderManagementV1.sol',sha256:LEGACY_SHA256}});
  return {interface:profiles[0].interface,profiles,transferInterface:new loaded.ethers.Interface([TRANSFER_ABI]),runtime:loaded.runtime,eventProfile};
}
export async function invoiceEventTopics({runtime={},events=EVENTS,eventProfile='all'}={}){
  need(Array.isArray(events)&&events.length>0&&new Set(events).size===events.length&&events.every(event=>EVENTS.includes(event)),
    'INVALID_EVENT_FILTER','Select original OrderCreated, OrderSettled or OrderRefunded events once each.');
  const selected=await invoiceInterface(runtime,{eventProfile}),topics=[];
  for(const profile of selected.profiles)for(const name of events)topics.push(profile.interface.getEvent(name).topicHash);
  return {topics:[...new Set(topics)],runtime:selected.runtime,eventProfile};
}
export async function decodeInvoiceLog(log,{runtime={},network=null,chainId=null,decoder=null}={}){
  object(log,'native log');
  need(typeof log.address==='string'&&/^0x[0-9a-fA-F]{40}$/.test(log.address),'INVALID_NATIVE_LOG','The original log has no contract address.');
  need(Array.isArray(log.topics)&&log.topics.every(topic=>typeof topic==='string'&&/^0x[0-9a-fA-F]{64}$/.test(topic)),
    'INVALID_NATIVE_LOG','The original log topics are not native 32-byte values.');
  need(typeof log.data==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data),'INVALID_NATIVE_LOG','The original log data is not complete native bytes.');
  const selected=decoder??await invoiceInterface(runtime);
  let decoded=null,matched=null,parseFailure=false;
  for(const profile of selected.profiles){
    try{const value=profile.interface.parseLog({topics:log.topics,data:log.data});if(value&&EVENTS.includes(value.name)){decoded=value;matched=profile;break;}}
    catch{parseFailure=true;}
  }
  if(!decoded){need(!parseFailure,'INVALID_NATIVE_EVENT','The original log does not match its retained event signature.');return {known:false,event:null,topic:log.topics[0]??null};}
  const a=decoded.args,orderId=canonicalHash(a.orderId),transactionHash=canonicalHash(log.transactionHash),blockHash=canonicalHash(log.blockHash);
  need(orderId&&transactionHash&&blockHash,'INVALID_NATIVE_LOG','A retained listener log requires its original order, transaction and block identifiers.');
  const blockNumber=integerText(log.blockNumber,'blockNumber',{hex:true}),logIndex=integerText(log.logIndex??log.index,'logIndex',{hex:true});
  const result={known:true,event:decoded.name,eventProfile:decoded.name==='OrderCreated'?'shared-v1-v2':matched.id,abiSource:matched.source,
    orderId,requester:a.requester===undefined?null:String(a.requester),token:a.token===undefined?null:String(a.token),
    transactionHash,blockHash,blockNumber,logIndex,contract:log.address,removed:log.removed===true,
    chainId:chainId===null?null:integerText(chainId,'chainId',{hex:true}),network};
  if(decoded.name==='OrderCreated'){
    Object.assign(result,{amount:a.amount.toString(),rate:a.rate.toString(),messageHash:a.messageHash,orderType:Number(a.orderType)});
    need(Number.isSafeInteger(result.orderType)&&result.orderType>=0&&result.orderType<=255,'INVALID_NATIVE_EVENT','The original uint8 order type is invalid.');
  }else if(decoded.name==='OrderSettled'&&a.netAmount!==undefined)
    Object.assign(result,{netAmount:a.netAmount.toString(),feeAmount:a.feeAmount.toString(),providerId:String(a.providerId)});
  else if(decoded.name==='OrderRefunded'&&a.amount!==undefined)result.amount=a.amount.toString();
  result.sourceOccurrenceKey=sha256({network,chainId:result.chainId,contract:log.address.toLowerCase(),transactionHash,logIndex,blockHash});
  return result;
}
export async function decodeInvoiceTransfers(receipt,{runtime={},network=null,chainId=null,decoder=null}={}){
  object(receipt,'native receipt');need(Array.isArray(receipt.logs),'INVALID_NATIVE_RECEIPT','The original receipt must retain its log array.');
  const selected=decoder??await invoiceInterface(runtime),topic=selected.transferInterface.getEvent('Transfer').topicHash,transfers=[];
  for(let index=0;index<receipt.logs.length;index++){
    const log=receipt.logs[index];
    if(!log||!Array.isArray(log.topics)||log.topics[0]?.toLowerCase()!==topic.toLowerCase())continue;
    // The indexed ERC-721 Transfer has a fourth topic; it is not an ERC-20 amount.
    if(log.topics.length!==3||typeof log.data!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(log.data))continue;
    need(/^0x[0-9a-fA-F]{40}$/.test(log.address??''),'INVALID_NATIVE_RECEIPT','The original token transfer has no contract address.');
    const parsed=selected.transferInterface.parseLog({topics:log.topics,data:log.data});
    const transactionHash=canonicalHash(log.transactionHash??receipt.transactionHash),blockHash=canonicalHash(log.blockHash??receipt.blockHash);
    need(transactionHash===canonicalHash(receipt.transactionHash)&&blockHash===canonicalHash(receipt.blockHash),
      'NATIVE_SELECTION_CHANGED','An original receipt log belongs to a different transaction or block.');
    transfers.push({event:'Transfer',network,chainId,token:log.address,from:String(parsed.args._from),to:String(parsed.args._to),
      units:parsed.args._value.toString(),transactionHash,blockHash,
      blockNumber:integerText(log.blockNumber??receipt.blockNumber,'blockNumber',{hex:true}),
      logIndex:integerText(log.logIndex??log.index,'logIndex',{hex:true}),removed:log.removed===true,
      originalIndex:index,originalSha256:sha256(log),standard:'https://eips.ethereum.org/EIPS/eip-20'});
  }
  return {transfers,runtime:selected.runtime};
}
