// Read or reopen the original public Safe execution through Protocol Kit 4.1.0.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

function need(value,message){if(!value)throw new Error(message);}
function integer(hex,name){
  need(typeof hex==='string'&&/^0x[0-9a-f]+$/i.test(hex),name+' quantity required');
  const value=BigInt(hex),number=Number(value);
  need(Number.isSafeInteger(number)&&BigInt(number)===value,name+' exact integer required');
  return number;
}
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function resolvePublicSafeRuntime(callerRoot){
  const caller=createRequire(resolve(callerRoot,'package.json'));
  const palmeraPackage=caller.resolve('@keyper-labs/palmera-module-sdk/package.json');
  const palmeraRequire=createRequire(palmeraPackage);
  const palmeraBytes=await readFile(palmeraPackage);
  const palmeraMetadata=JSON.parse(palmeraBytes);
  const protocolPath=palmeraRequire.resolve('@safe-global/protocol-kit/package.json');
  const protocolBytes=await readFile(protocolPath);
  const protocolMetadata=JSON.parse(protocolBytes);
  need(palmeraMetadata.version==='1.0.0-beta.1'&&protocolMetadata.version==='4.1.0','Original SDK version pair required');
  const sdk=palmeraRequire('@safe-global/protocol-kit');
  return {sdk,runtime:{callerRoot:resolve(callerRoot),palmeraPackage,protocolPackage:protocolPath,
    palmeraVersion:palmeraMetadata.version,protocolVersion:protocolMetadata.version,
    palmeraMetadataSha256:sha(palmeraBytes),protocolMetadataSha256:sha(protocolBytes)}};
}

function exactContext(actual,retained){
  const fields=['networkId','blockNumber','transactionIndex','from','gas','value'];
  need(retained&&typeof retained==='object'&&!Array.isArray(retained)&&
    Object.keys(retained).length===fields.length&&fields.every(key=>Object.hasOwn(retained,key)),
    'Original six-field observed context required');
  need(fields.every(key=>key==='from'?same(actual[key],retained[key]):actual[key]===retained[key]),
    'Original observed context changed');
}

async function loadPublicSafe({callerRoot,rpc,sourceFile,observed}){
  const source=JSON.parse(await readFile(resolve(sourceFile),'utf8'));
  need(source.schema==='stellar-forge.public-safe-receiving-source.v1','Original receiving source required');
  const {sdk,runtime}=await resolvePublicSafeRuntime(callerRoot);
  const Safe=sdk.default;
  need(typeof rpc==='string'&&new URL(rpc).protocol==='https:','Selected public HTTPS RPC required');
  const safe=await Safe.init({provider:rpc,safeAddress:source.safe});
  const provider=safe.getSafeProvider().getExternalProvider();
  let closed=false;
  const close=async()=>{if(!closed){closed=true;if(typeof provider.destroy==='function')await provider.destroy();}};
  try {
    const chainId=await safe.getChainId();
    need(chainId.toString()===source.networkId,'Original chain mismatch');
    let outer,receipt;
    if(observed){
      need(observed.outer&&observed.receipt&&observed.context,'Retained original transaction, receipt and context required');
      ({outer,receipt}=observed);
    }else{
      [outer,receipt]=await Promise.all([
        provider.send('eth_getTransactionByHash',[source.outerTransactionHash]),
        provider.send('eth_getTransactionReceipt',[source.outerTransactionHash])
      ]);
    }
    need(outer&&receipt,'Original mined transaction and receipt required');
    need(same(outer.hash,source.outerTransactionHash)&&same(receipt.transactionHash,outer.hash),'Outer transaction changed');
    need(same(outer.to,source.safe)&&same(outer.from,source.executor),'Original Safe or executor mismatch');
    need(same(receipt.blockHash,outer.blockHash)&&receipt.blockNumber===outer.blockNumber&&receipt.transactionIndex===outer.transactionIndex,'Original block binding changed');
    need(integer(outer.blockNumber,'block')===source.blockNumber,'Original block changed');
    need(integer(receipt.status,'receipt status')===1&&integer(receipt.gasUsed,'receipt gas used')===source.reportedOutcome.gasUsed,'Original executed outcome changed');
    const transaction=new sdk.EthSafeTransaction({...source.transaction.data});
    for(const signature of source.transaction.signatures){
      need(signature.type==='APPROVED_HASH','This source loader expects the retained approved-hash signature');
      transaction.addSignature(new sdk.EthSafeSignature(signature.owner,signature.signature,false));
    }
    need(same(transaction.encodedSignatures(),source.expectedEncodedSignatures),'Original signature bytes changed');
    const [hash,encoded]=await Promise.all([safe.getTransactionHash(transaction),safe.getEncodedTransaction(transaction)]);
    need(same(hash,source.safeTxHash)&&same(encoded,outer.input),'Original SDK hash or execution calldata mismatch');
    const context={networkId:chainId.toString(),blockNumber:integer(outer.blockNumber,'block'),
      transactionIndex:integer(outer.transactionIndex,'position'),from:outer.from,
      gas:integer(outer.gas,'outer gas limit'),value:BigInt(outer.value).toString()};
    if(observed)exactContext(context,observed.context);
    return {safe,transaction,context,source,outer,receipt,close,runtime,
      label:'Original Gnosis Safe owner replacement, nonce 5',
      origin:{application:'Safe public transaction source',operation:'swapOwner',reference:source.source.url}};
  }catch(error){await close();throw error;}
}

export async function readPublicSafe(options){
  return loadPublicSafe({...options,observed:undefined});
}

// Reuse the saved RPC result objects and observed six-field context. The same
// SDK still checks its live chain/Safe identity, transaction hash and calldata;
// reopening does not fetch or replace the saved outer transaction or receipt.
export async function reopenPublicSafe({outer,receipt,context,...options}){
  return loadPublicSafe({...options,observed:{outer,receipt,context}});
}
