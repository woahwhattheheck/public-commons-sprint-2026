// MIT. Native supplier-cost files and requests on the original merchant MCP transport.
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/,ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_BYTES=512*1024*1024;
const fail=(code,message)=>Object.assign(new Error(message),{code:'PRICING_COST_CLIENT_'+code});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const pricingCostClientOperations=Object.freeze(Object.fromEntries([
  'state','list','inputs','input','upload','capture','source','mapping','weights','preview','save','request','edition',
  'compare','proposal','apply','export','manifest','receive','received','receiving-review','receiving-draft'
].map(name=>['cost-'+name,'merchant_pricing_cost_'+name.replaceAll('-','_')])));

function parseManifest(bytes,id,kind){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw fail('MANIFEST_INVALID','The original cost manifest must be complete UTF-8 JSON.');}
  if(value?.schema!=='stellar-forge.merchant-cost-files.v1'||value.id!==id||value.kind!==kind||!plain(value.files))
    throw fail('MANIFEST_INVALID','Use the exact source, edition or export manifest selected for this download.');
  const files=Object.entries(value.files).map(([name,file])=>{
    if(!/^[-A-Za-z0-9_.]+$/.test(name)||['.','..','manifest.json','download-state'].includes(name)||!plain(file)||
       !Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAX_BYTES||!HASH.test(file.sha256??''))
      throw fail('MANIFEST_INVALID','A cost file has an unsupported filename, byte count or original SHA-256.');
    return {name,bytes:file.bytes,sha256:file.sha256};
  });
  if(!files.length||files.length>32||files.reduce((sum,row)=>sum+row.bytes,0)>MAX_BYTES)
    throw fail('MANIFEST_INVALID','Select the complete native file set within the 512 MiB original package limit.');
  if(kind==='source'&&(files.length!==1||files[0].name!=='original'||value.source?.sourceId!==id||
      files[0].sha256!==value.source.sha256||files[0].bytes!==value.source.bytes)||
     ['export','received'].includes(kind)&&(files.length!==1||files[0].name!==id+'.tar'||value.requestId!==id)||
     kind==='edition'&&(!Object.hasOwn(value.files,'edition-manifest.json')||!UUID.test(value.pricingVersion??'')||
      !HASH.test(value.nativeManifestSha256??'')||value.revision!==value.nativeManifestSha256||value.files['edition-manifest.json'].sha256!==value.nativeManifestSha256))
    throw fail('MANIFEST_INVALID','The cost file set does not match its original source, native edition or archive identity.');
  return {...value,exportId:id,files};
}
function downloader(workspace,kind){
  if(!ALIAS.test(workspace??'')||!['source','edition','export','received'].includes(kind))
    throw fail('ARGUMENTS','Select the original pricing workspace alias and source, edition or export kind.');
  return createRetainedDownload({
    manifestName:'manifest.json',parseManifest:(bytes,id)=>parseManifest(bytes,id,kind),maximumBytes:MAX_BYTES,
    stateSchema:'stellar-forge.cost-download-state.v1',resultSchema:'stellar-forge.cost-download.v1',
    toolPrefix:'merchant_pricing_cost',errorPrefix:'PRICING',clientName:'starforge-merchant-costs',
    describe:value=>({kind:value.kind,id:value.id,pricingVersion:value.pricingVersion??null,nativeManifestSha256:value.nativeManifestSha256??null}),
    connect:async options=>{
      const original=await openMerchantFileClient(options);
      await original.call('merchant_pricing_open',{workspace});
      return {endpoint:original.endpoint,async call(name,args,requestOptions){
        const {exportId,...selectors}=args;
        const selected=name.endsWith('_file_release')?{workspace,readId:selectors.readId}:{workspace,kind,id:exportId,...selectors};
        const result=await original.call(name,selected,requestOptions);
        if(result.workspace!==workspace||result.id!==undefined&&result.id!==exportId||result.kind!==undefined&&result.kind!==kind)
          throw fail('IDENTITY_CHANGED','The MCP reply belongs to a different pricing workspace or cost artifact.');
        return {...result,exportId,...(name.endsWith('_manifest')?{state:'MANIFEST_RETAINED'}:{})};
      }};
    }
  });
}

/** Original chunk validation, private staging, exact-file recovery and completion
 * manifests remain owned by the maintained retained downloader.
 */
export function downloadMerchantCosts({workspace,kind,id,...options}={}){
  if(!UUID.test(id??''))throw fail('ARGUMENTS','Supply the exact native source, edition or export request ID.');
  return downloader(workspace,kind).download({...options,exportId:id});
}
export function inspectMerchantCosts({workspace,kind,id,...options}={}){
  if(!UUID.test(id??''))throw fail('ARGUMENTS','Supply the exact native source, edition or export request ID.');
  return downloader(workspace,kind).inspect({...options,exportId:id});
}
