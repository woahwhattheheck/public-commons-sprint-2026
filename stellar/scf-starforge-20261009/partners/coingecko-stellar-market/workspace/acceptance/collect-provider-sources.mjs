#!/usr/bin/env node
/**
 * Retain one actual unsigned CoinGecko response for each documented family.
 * No wallet, API key, Payment-Signature or signed retry is used by this command.
 */
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const args=process.argv.slice(2);
if(args.includes('--help')){process.stdout.write('Usage: node collect-provider-sources.mjs --directory PATH [--requests FILE]\nRetains five unsigned source observations; no payment or API key.\n');process.exit(0)}
for(let index=0;index<args.length;index+=2)if(!['--directory','--requests'].includes(args[index])||!args[index+1])throw new Error('Use --help for source collector arguments.');
function option(name,fallback){const index=args.indexOf(name);if(index<0)return fallback;if(!args[index+1]||args[index+1].startsWith('--'))throw new Error('Missing '+name);return args[index+1]}
const directory=resolve(option('--directory','./coingecko-original-sources'));
const definitions=JSON.parse(await readFile(resolve(option('--requests',join(dirname(fileURLToPath(import.meta.url)),'sources.example.json'))),'utf8'));
if(!Array.isArray(definitions)||definitions.length!==5)throw new Error('The source request file must contain all five families.');
const endpoints=new Set(['simple-price','token-prices','search-pools','trending-pools','token-data']);
const safeName=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{1,80}$/.test(value);
for(const item of definitions){
  if(!endpoints.delete(item.endpoint)||!safeName(item.responseStem)||!safeName(item.challengeStem))throw new Error('Source definitions contain duplicate or invalid families/filenames.');
  const url=new URL(item.url);
  if(url.protocol!=='https:'||url.origin!=='https://pro-api.coingecko.com'||!url.pathname.startsWith('/api/v3/x402/')||url.username||url.password||url.hash)throw new Error('Retain the documented original CoinGecko HTTPS request, including its query.');
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=path=>stat(path).then(()=>true).catch(error=>{if(error.code==='ENOENT')return false;throw error});
async function putExact(path,bytes){
  if(await exists(path)){if(!(await readFile(path)).equals(Buffer.from(bytes)))throw new Error('Existing source bytes differ: '+path);return}
  await writeFile(path,bytes,{flag:'wx',mode:0o600});
}
async function save(path,value){
  const temporary=path+'.writing-'+process.pid;
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await rename(temporary,path);
}
await mkdir(directory,{recursive:true,mode:0o700});
const manifestFile=join(directory,'SOURCE_CAPTURE.json');
const manifest=await exists(manifestFile)?JSON.parse(await readFile(manifestFile,'utf8')):
 {schema:'coingecko.unsigned-provider-sources.v1',createdAt:new Date().toISOString(),signedPayments:0,families:{}};
if(manifest.schema!=='coingecko.unsigned-provider-sources.v1'||manifest.signedPayments!==0)throw new Error('Unexpected retained source manifest.');
async function receive(url){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('Original source request timed out')),45000);
  try{
    const startedAt=new Date().toISOString();
    const response=await fetch(url,{method:'GET',headers:{Accept:'application/json','Accept-Encoding':'identity'},redirect:'manual',signal:controller.signal});
    const observedAt=new Date().toISOString(),reader=response.body?.getReader(),chunks=[];let bytes=0,truncated=false;
    if(reader)for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;
      if(bytes>15_000_000){truncated=true;await reader.cancel();break}chunks.push(Buffer.from(item.value));}
    const body=Buffer.concat(chunks);
    return {body,metadata:{url,method:'GET',status:response.status,observed_at:observedAt,request_started_at:startedAt,
      response_url:response.url,headers:Object.fromEntries(response.headers),bytes:body.length,body_sha256:sha(body),
      signed_payment_supplied:false,truncated}};
  }finally{clearTimeout(timer)}
}
const failures=[];
for(const definition of definitions){
  const current=manifest.families[definition.endpoint]??={url:definition.url,attempts:[]};
  if(current.url!==definition.url)throw new Error('Retained request changed for '+definition.endpoint+'; retain the next observation in a new source directory.');
  try{
    let body,metadata,challenge,metadataBytes;
    if(current.readyAttempt){
      const attempt=join(directory,current.readyAttempt);
      metadataBytes=await readFile(join(attempt,'response.json'));metadata=JSON.parse(metadataBytes);
      body=await readFile(join(attempt,'response.bin'));challenge=await readFile(join(attempt,'payment-required.json'));
    }else if(await exists(join(directory,definition.responseStem+'.json'))){
      metadataBytes=await readFile(join(directory,definition.responseStem+'.json'));metadata=JSON.parse(metadataBytes);
      body=await readFile(join(directory,definition.responseStem+'.bin'));challenge=await readFile(join(directory,definition.challengeStem+'.json'));
    }else{
      const attemptName='attempts/'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID();
      const attempt=join(directory,attemptName);await mkdir(attempt,{recursive:true,mode:0o700});
      current.attempts.push({path:attemptName,startedAt:new Date().toISOString()});await save(manifestFile,manifest);
      const received=await receive(definition.url);body=received.body;metadata=received.metadata;
      metadataBytes=Buffer.from(JSON.stringify(metadata,null,2)+'\n');
      await putExact(join(attempt,'response.bin'),body);await putExact(join(attempt,'response.json'),metadataBytes);
      const header=Object.entries(metadata.headers).find(([name])=>name.toLowerCase()==='payment-required')?.[1];
      if(header){challenge=Buffer.from(header,'base64');await putExact(join(attempt,'payment-required.json'),challenge)}
      Object.assign(current.attempts.at(-1),{finishedAt:new Date().toISOString(),status:metadata.status,bytes:body.length,bodySha256:sha(body)});
      await save(manifestFile,manifest);
      if(metadata.status!==402||metadata.truncated||!challenge)throw new Error('Retained HTTP '+metadata.status+'; an original complete 402 challenge was not returned.');
      if(JSON.parse(challenge).x402Version!==2)throw new Error('The retained original challenge is not x402 version 2.');
      current.readyAttempt=attemptName;await save(manifestFile,manifest);
    }
    const original=JSON.parse(challenge),header=Object.entries(metadata.headers).find(([name])=>name.toLowerCase()==='payment-required')?.[1];
    if(metadata.url!==definition.url||metadata.method!=='GET'||metadata.status!==402||metadata.signed_payment_supplied!==false||
       metadata.truncated||metadata.bytes!==body.length||metadata.body_sha256!==sha(body)||original.x402Version!==2||
       !header||!isDeepStrictEqual(JSON.parse(Buffer.from(header,'base64')),original))throw new Error('The retained original response/challenge binding changed.');
    await putExact(join(directory,definition.responseStem+'.bin'),body);
    await putExact(join(directory,definition.responseStem+'.json'),metadataBytes);
    await putExact(join(directory,definition.challengeStem+'.json'),challenge);
    Object.assign(current,{completed:true,observedAt:metadata.observed_at,metadataSha256:sha(metadataBytes),bodySha256:sha(body),
      challengeSha256:sha(challenge),bytes:body.length,files:{metadata:definition.responseStem+'.json',body:definition.responseStem+'.bin',challenge:definition.challengeStem+'.json'}});
    delete current.lastError;await save(manifestFile,manifest);
  }catch(error){current.lastError={at:new Date().toISOString(),message:error.message};failures.push({endpoint:definition.endpoint,...current.lastError});await save(manifestFile,manifest);}
}
manifest.status=failures.length?'INCOMPLETE':'COMPLETE';manifest.observedAt=new Date().toISOString();await save(manifestFile,manifest);
process.stdout.write(JSON.stringify({status:manifest.status,directory,manifestFile,signedPayments:0,
 families:Object.fromEntries(Object.entries(manifest.families).map(([key,value])=>[key,{complete:value.completed===true,observedAt:value.observedAt,bytes:value.bytes,bodySha256:value.bodySha256}])),failures})+'\n');
if(failures.length)process.exitCode=1;
