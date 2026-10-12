// MIT. Original PMTiles output bytes in the existing SF82 release lifecycle.
import {mkdir,rm,open,unlink,rename,realpath} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readBytes,writeBytes,syncDirectory,privateDirectory} from '../sf88-operator-buyer-cli/node/store.mjs';
import {need,digest,hash,clone} from '../sf30-seller-sdk/pmtiles/model.mjs';
import {retainFile} from '../sf30-seller-sdk/pmtiles/files.mjs';
import {readOutputPackage} from '../sf30-seller-sdk/pmtiles/commerce/package.mjs';
import {openOutputSource} from '../sf30-seller-sdk/pmtiles/commerce/source.mjs';
import {MAX_OUTPUT_BYTES,OUTPUT_METADATA_BYTES} from '../sf30-seller-sdk/pmtiles/commerce/model.mjs';
import {readSellerConfig,startSellerService} from '../sf30-seller-sdk/serve.mjs';
import {compileSellerRoutes} from '../sf30-seller-sdk/resource-server.mjs';
import {PMTILES_OUTPUT_SOURCE_SCHEMA} from './release-source-contracts.mjs';
export {PMTILES_OUTPUT_SOURCE_SCHEMA} from './release-source-contracts.mjs';

const format=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sorted=rows=>rows.sort((a,b)=>a.file.localeCompare(b.file));
const file=(name,raw)=>({file:name,bytes:raw.length,sha256:hash(raw)});
function sourceMetadata(prepared){
  return {schema:'starforge.pmtiles-output-release-source.v1',packageManifestSha256:prepared.manifestSha256,
    sourceSha256:prepared.manifest.sourceSha256,catalogSha256:prepared.manifest.catalogSha256,
    executionSha256:digest({source:prepared.source,service:prepared.documents.service}),
    offerId:prepared.source.offerId,release:clone(prepared.source.release),
    objects:clone(prepared.documents.description.objects)};
}
function compileOriginalService(service){
  compileSellerRoutes(service.routes.map(route=>({id:route.id,offer:route.offer,
    handler:async()=>{throw new Error('Output release inspection never delivers a file.');}})));
}
export async function preparePMTilesOutputRelease(packageDirectory,options={}){
  const prepared=await readOutputPackage(packageDirectory,options);
  const service=await readSellerConfig(join(prepared.directory,'seller-service.json'));
  need(digest(service)===digest(prepared.documents.service),'PMTILES_OUTPUT_SERVICE_CHANGED');
  compileOriginalService(service);
  return {...prepared,service,offers:prepared.documents.offers,pmtilesOutput:sourceMetadata(prepared)};
}
/** SF82 owns the final atomic directory publication and release record. */
export async function stagePMTilesOutputRelease(directory,packageDirectory,{expectedManifestSha256,signal}={}){
  need(/^[a-f0-9]{64}$/.test(expectedManifestSha256??''),'PMTILES_OUTPUT_REVIEWED_PACKAGE_REQUIRED');
  const prepared=await preparePMTilesOutputRelease(packageDirectory,{expectedManifestSha256,signal});
  const root=resolve(directory),source=prepared.directory;
  need(root!==source&&!root.startsWith(source+sep)&&!source.startsWith(root+sep),'PMTILES_OUTPUT_SEPARATE_RELEASE_STORE_REQUIRED');
  need(await realpath(dirname(root))===dirname(root),'PMTILES_OUTPUT_CANONICAL_RELEASE_PARENT_REQUIRED');
  let created=false;
  try{
    await mkdir(root,{mode:0o700});created=true;
    const retained=join(root,'pmtiles-output');await privateDirectory(retained);
    for(const row of prepared.files){
      signal?.throwIfAborted();
      await retainFile(join(source,row.path),join(retained,row.path),{expected:row,limit:MAX_OUTPUT_BYTES,signal});
    }
    const offersRaw=format(prepared.offers),serviceRaw=format(prepared.service);
    await writeBytes(join(root,'offers.json'),offersRaw,{exclusive:true});
    await writeBytes(join(root,'seller-service.json'),serviceRaw,{exclusive:true});
    const files=sorted(prepared.files.map(row=>({file:'pmtiles-output/'+row.path,bytes:row.bytes,sha256:row.sha256})));
    const manifest={schema:PMTILES_OUTPUT_SOURCE_SCHEMA,packagePath:'pmtiles-output',pmtilesOutput:prepared.pmtilesOutput,
      offersSha256:hash(offersRaw),serviceConfigSha256:hash(serviceRaw),files};
    await writeBytes(join(root,'manifest.json'),format(manifest),{exclusive:true});
    await syncDirectory(retained);await syncDirectory(root);
    return inspectPMTilesOutputRelease(root,{signal});
  }catch(error){if(created)await rm(root,{recursive:true,force:true});throw error;}
}
export async function inspectPMTilesOutputRelease(directory,{signal}={}){
  const root=resolve(directory),manifestRaw=await readBytes(join(root,'manifest.json'),2097152);
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestRaw));
  need(manifest.schema===PMTILES_OUTPUT_SOURCE_SCHEMA&&manifest.packagePath==='pmtiles-output'&&
    manifest.pmtilesOutput&&Array.isArray(manifest.files),'PMTILES_OUTPUT_RELEASE_MANIFEST_INVALID');
  const prepared=await preparePMTilesOutputRelease(join(root,'pmtiles-output'),
    {expectedManifestSha256:manifest.pmtilesOutput.packageManifestSha256,signal});
  const files=sorted(prepared.files.map(row=>({file:'pmtiles-output/'+row.path,bytes:row.bytes,sha256:row.sha256})));
  need(digest(files)===digest(manifest.files)&&digest(prepared.pmtilesOutput)===digest(manifest.pmtilesOutput),
    'PMTILES_OUTPUT_RELEASE_SOURCE_CHANGED');
  const offersRaw=await readBytes(join(root,'offers.json'),OUTPUT_METADATA_BYTES);
  const serviceRaw=await readBytes(join(root,'seller-service.json'),1048576);
  need(hash(offersRaw)===manifest.offersSha256&&hash(serviceRaw)===manifest.serviceConfigSha256&&
    offersRaw.equals(format(prepared.offers))&&serviceRaw.equals(format(prepared.service)),
    'PMTILES_OUTPUT_RELEASE_OFFERS_CHANGED');
  return {manifest,pmtilesOutput:prepared.pmtilesOutput,offers:prepared.offers,service:prepared.service,
    hasApplication:true,files:sorted([file('manifest.json',manifestRaw),file('offers.json',offersRaw),
      file('seller-service.json',serviceRaw),...files])};
}
async function selectedRuntime(input){
  need(input&&Object.keys(input).every(key=>['port','facilitator','allowLocalFacilitator'].includes(key)),
    'PMTILES_OUTPUT_RUNTIME_FIELDS_INVALID');
  return (await import('./releases.mjs')).normalizeReleaseRuntime(clone(input));
}
/** Uses the same original seller/payment engine and callback ABI as other SF82 sources. */
export async function startPMTilesOutputRelease(directory,{runtime={port:0},nativeFactory:providedFactory,signal}={}){
  runtime=clone(runtime);
  const snapshot=await inspectPMTilesOutputRelease(directory,{signal}),options=await selectedRuntime(runtime);
  const source=await openOutputSource(join(resolve(directory),'pmtiles-output'),
    {expectedManifestSha256:snapshot.pmtilesOutput.packageManifestSha256,signal});
  let session;
  try{
    const handlers=Object.create(null);
    for(const route of snapshot.service.routes){const original=source.route(route.id);
      handlers[route.handler]=original.handler;handlers[route.admit]=original.admit;}
    let nativeFactory=providedFactory??null;
    if(!nativeFactory&&options.facilitator){
      const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([
        import('@x402/core/server'),import('../sf30-seller-sdk/native-factory.mjs')]);
      nativeFactory=compiled=>createNativeSellerServer(compiled,{
        facilitatorClient:new HTTPFacilitatorClient({url:options.facilitator.replace(/\/$/,'')})});
    }
    session=await startSellerService({config:snapshot.service,port:options.port,handlers,nativeFactory});
    let closing;
    const close=()=>closing??=(async()=>{try{return await session.close();}finally{await source.close();}})();
    return {...session,source,pmtilesOutput:snapshot.pmtilesOutput,snapshot,close};
  }catch(error){await session?.close().catch(()=>{});await source.close().catch(()=>{});throw error;}
}
export async function launch(args=process.argv.slice(2)){
  if(args.length!==2||args[0]!=='--resume')throw new TypeError('Usage: node release-pmtiles-output.mjs --resume RELEASE_DIRECTORY');
  const directory=resolve(args[1]),snapshot=await inspectPMTilesOutputRelease(directory);
  const saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(join(directory,'pilot-runtime.json'),65536)));
  need(saved.schema==='stellar-forge.seller-pilot-runtime.v1'&&
    saved.source?.offersSha256===snapshot.manifest.offersSha256&&
    saved.source?.serviceConfigSha256===snapshot.manifest.serviceConfigSha256,'PMTILES_OUTPUT_RUNTIME_SELECTION_CHANGED');
  const session=await startPMTilesOutputRelease(directory,{runtime:saved.options});
  try{
    const receipt={schema:'stellar-forge.seller-pilot-readiness.v1',observedAt:new Date().toISOString(),
      originalOffersSha256:snapshot.manifest.offersSha256,originalServiceConfigSha256:snapshot.manifest.serviceConfigSha256,
      runtimeMode:session.mode,listener:session.url,routeCount:snapshot.service.routes.length,pmtilesOutput:snapshot.pmtilesOutput};
    await writeBytes(join(directory,'runtime-readiness.json'),format(receipt));
    const onSignal=()=>{void session.close().then(()=>{process.exitCode=0;},()=>{process.exitCode=1;});};
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,onSignal);
    const close=session.close;
    session.close=async()=>{try{return await close();}finally{
      for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,onSignal);}};
    return session;
  }catch(error){await session.close().catch(()=>{});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  launch().catch(error=>{process.stderr.write((error.code??'PMTILES_OUTPUT_LAUNCH_FAILED')+': '+error.message+'\n');process.exitCode=1;});
