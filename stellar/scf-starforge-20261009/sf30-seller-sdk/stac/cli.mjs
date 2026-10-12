#!/usr/bin/env node
import {readFile,mkdir,open,rename,link,unlink} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {openStacWorkspace} from './workspace.mjs';
import {startStacServer} from './server.mjs';

export const STAC_HELP=`Earth Search scene operations

Usage:
  node sf30-seller-sdk/stac/cli.mjs COMMAND --workspace /absolute/workspace [options]

Analyst workspace:
  init       --title TEXT --endpoint URL [--transport JSON_FILE]
  serve      [--port 0] [--max-request-bytes NUMBER]
             [--processing-workspace DIR [--processing-config JSON_FILE]]
  state
  discover   [--operation-id ID] [--expected-revision NUMBER]
  query-save --input JSON_FILE
             or --name TEXT --collections IDS --bbox W,S,E,N
                --datetime START/END [--cloud-cover-max NUMBER]
                [--page-size 100] [--max-pages 10]
             --intersects JSON_FILE may replace --bbox
  review     --query ID
  acquire    --review ID [--operation-id ID]
  resume     --edition ID
  cancel     --edition ID
  edition    --edition ID
  edition-export --edition ID --out DIR
                 Writes the complete source/asset directory for merchant-stage.
  asset-review   --edition ID --item COMPOSITE_KEY --asset KEY [--max-bytes NUMBER]
  asset-acquire  --review ID [--operation-id ID]
  asset-download --asset-id ID --out FILE [--overwrite]
  decision   --input JSON_FILE
             or --edition ID --item COMPOSITE_KEY --status SELECTED|REJECTED|REVIEW
                --actor TEXT [--note TEXT|--note-file FILE] [--asset-keys KEYS]
  compare    --left EDITION_ID --right EDITION_ID
  report     --edition ID --format html|csv|json --out FILE [--overwrite]
  export     --out FILE [--editions IDS] [--include-assets false] [--overwrite]
  import     --input HANDOVER_JSON_FILE

Original merchant/customer controller:
  merchant-stage  --edition DIR --directory DIR --origin URL
                  --payment JSON_FILE [--path PATH]
  merchant-serve  --directory DIR [--port NUMBER] [--facilitator URL]
                  [--allow-local-facilitator] [--challenge-only]
  merchant-status --directory DIR
  customer-create --directory DIR --merchant DIR --id ID
                  --buyer-config JSON_FILE --max-pages NUMBER
                  --max-total-atomic NUMBER [--query JSON_FILE]
                  [--files JSON_FILE] [--chunk-bytes NUMBER]
  customer-inspect|customer-run|customer-recover
                  --directory DIR --buyer-config JSON_FILE
  customer-deliver --directory DIR --buyer-config JSON_FILE --out DIR
  customer-open    --directory DIR

Offline GIS from the original customer delivery:
  portable-export --directory RECEIVED_DIR --out PORTABLE_DIR
  portable-open   --directory PORTABLE_DIR [--expected-manifest-sha256 SHA256]

The portable export retains original delivery files, source/asset identities,
GeoJSON, collection rights and the offline scene explorer. Both commands work
without an analyst workspace or Buyer connection.

Scene identity is collection-scoped:
  encodeURIComponent(collection) + '/' + encodeURIComponent(native scene ID)

Query and asset review are explicit saved actions. Edition/report/export commands
read the existing workspace; they do not fetch provider data. JSON-file flags
refer to local files. A server prints its private local session URL for the
operator. Keep that running process available while using its browser session.
`;
function parseArgs(argv){
  const flags={},positionals=[];
  for(let index=0;index<argv.length;index++){
    const value=argv[index];
    if(value==='--'){positionals.push(...argv.slice(index+1));break;}
    if(value.startsWith('--')){
      const equal=value.indexOf('=');
      if(equal>=0){flags[value.slice(2,equal)]=value.slice(equal+1);continue;}
      const key=value.slice(2),next=argv[index+1];
      if(next!==undefined&&!next.startsWith('--')){flags[key]=next;index++;}else flags[key]=true;
    }else positionals.push(value);
  }
  return {flags,positionals};
}
function required(flags,name){const value=flags[name];if(typeof value!=='string'||!value.length)throw new Error('--'+name+' is required.');return value;}
function number(flags,name,fallback){if(flags[name]===undefined)return fallback;const value=Number(flags[name]);if(!Number.isFinite(value))throw new Error('--'+name+' must be numeric.');return value;}
const bool=(value,fallback=false)=>value===undefined?fallback:value===true||value==='true';
const split=value=>String(value).split(',').map(item=>item.trim()).filter(Boolean);
const readJSON=async path=>JSON.parse(await readFile(resolve(path),'utf8'));
const stdout=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function saveFile(path,data,{overwrite=false}={}){
  const destination=resolve(path),temporary=resolve(dirname(destination),'.'+basename(destination)+'.'+randomUUID()+'.partial');
  await mkdir(dirname(destination),{recursive:true});
  const handle=await open(temporary,'wx');
  try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
  try{if(overwrite)await rename(temporary,destination);else{await link(temporary,destination);await unlink(temporary);}}
  catch(error){await unlink(temporary).catch(()=>{});if(error.code==='EEXIST')throw new Error('Output already exists: '+destination+'. Use --overwrite to replace it.');throw error;}
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
  return {path:destination,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function saveAssetFile(workspace,assetId,path,{overwrite=false}={}){
  if(typeof workspace.getAssetFile!=='function'){const value=await workspace.getAsset(assetId);return saveFile(path,value.bytes,{overwrite});}
  const source=await workspace.getAssetFile(assetId),destination=resolve(path),temporary=resolve(dirname(destination),'.'+basename(destination)+'.'+randomUUID()+'.partial');
  await mkdir(dirname(destination),{recursive:true});
  const hash=createHash('sha256');let size=0;
  const digest=new Transform({transform(chunk,encoding,done){size+=chunk.length;hash.update(chunk);done(null,chunk);}});
  try{
    await pipeline(createReadStream(source.path),digest,createWriteStream(temporary,{flags:'wx'}));
    const sha256=hash.digest('hex');
    if(source.metadata?.sha256&&source.metadata.sha256!==sha256)throw new Error('The saved asset bytes no longer match their recorded SHA256.');
    if(overwrite)await rename(temporary,destination);else{await link(temporary,destination);await unlink(temporary);}
    return {path:destination,bytes:size,sha256};
  }catch(error){await unlink(temporary).catch(()=>{});if(error.code==='EEXIST')throw new Error('Output already exists: '+destination+'. Use --overwrite to replace it.');throw error;}
}

async function keepOpen(close){
  await new Promise((resolve,reject)=>{
    let stopped=false;
    const finish=()=>{if(stopped)return;stopped=true;process.removeListener('SIGINT',finish);process.removeListener('SIGTERM',finish);Promise.resolve().then(close).then(resolve,reject);};
    process.once('SIGINT',finish);process.once('SIGTERM',finish);
  });
}
export async function runStacCLI(argv=process.argv.slice(2)){
  const {flags,positionals}=parseArgs(argv),command=positionals[0]||'help';
  if(command==='help'||flags.help){process.stdout.write(STAC_HELP);return;}
  if(command.startsWith('merchant-')||command.startsWith('customer-')){
    const {runStacCommercialCommand}=await import('./customer.mjs');
    const {result,close}=await runStacCommercialCommand({command,flags});stdout(result);if(close)await keepOpen(close);return;
  }
  if(command==='portable-export'||command==='portable-open'){
    const directory=resolve(required(flags,'directory'));
    const {exportPortableStacDelivery,openPortableStacDelivery}=await import('./receiving/delivery.mjs');
    if(command==='portable-export'){
      const {StacDelivery}=await import('./customer.mjs');
      const delivery=await StacDelivery.open(directory);
      stdout(await exportPortableStacDelivery(delivery,resolve(required(flags,'out'))));return;
    }
    const opened=await openPortableStacDelivery(directory,
      flags['expected-manifest-sha256']?{expectedManifestSha256:required(flags,'expected-manifest-sha256')}:{});
    stdout({directory:opened.directory,editionId:opened.delivery.edition.id,editionDigest:opened.delivery.edition.digest,
      bundleSha256:opened.delivery.manifest.bundleSha256,manifestFile:opened.manifestFile.record,
      paths:opened.paths,summary:opened.manifest.summary,sourceDelivery:opened.manifest.sourceDelivery});return;
  }
  const directory=resolve(String(flags.workspace||flags.directory||''));
  if(!flags.workspace&&!flags.directory)throw new Error('--workspace is required for analyst workspace commands.');
  const transport=flags.transport?await readJSON(required(flags,'transport')):undefined;
  const workspace=await openStacWorkspace({directory,...(flags.title?{title:String(flags.title)}:{}),...(flags.endpoint?{endpoint:String(flags.endpoint)}:{}),...(transport?{transport}:{}),create:command==='init'});
  let processingController;
  try{
    const expectedRevision=number(flags,'expected-revision',undefined);
    const operationId=String(flags['operation-id']||randomUUID());
    if(command==='init'||command==='state'){stdout(await workspace.getState());return;}
    if(command==='serve'){
      if(flags['processing-workspace']||flags['processing-config']){
        const processingDirectory=resolve(required(flags,'processing-workspace'));
        const {createProcessingController}=await import('./processing/workspace.mjs');
        if(typeof createProcessingController!=='function')throw new Error('The installed processing module needs createProcessingController.');
        processingController=await createProcessingController({stacWorkspace:workspace,directory:processingDirectory,
          ...(flags['processing-config']?{config:await readJSON(required(flags,'processing-config'))}:{})});
      }
      const running=await startStacServer({workspace,...(processingController?{processing:processingController}:{}),port:number(flags,'port',0),...(flags['max-request-bytes']?{maxRequestBytes:number(flags,'max-request-bytes')}:{} )});
      stdout({url:running.url,workspaceId:(await workspace.getState()).id});
      await keepOpen(running.close);return;
    }
    if(command==='discover'){stdout(await workspace.discover({operationId,expectedRevision}));return;}
    if(command==='query-save'){
      let input;
      if(flags.input)input=await readJSON(required(flags,'input'));
      else{
        input={...(flags.id?{id:String(flags.id)}:{}),name:required(flags,'name'),collections:split(required(flags,'collections')),datetime:required(flags,'datetime'),pageSize:number(flags,'page-size',100),maxPages:number(flags,'max-pages',10)};
        if(flags.intersects)input.intersects=await readJSON(required(flags,'intersects'));else input.bbox=split(required(flags,'bbox')).map(Number);
        if(flags['cloud-cover-max']!==undefined)input.cloudCoverMax=number(flags,'cloud-cover-max');
      }
      if(expectedRevision!==undefined)input.expectedRevision=expectedRevision;
      stdout(await workspace.saveQuery(input));return;
    }
    if(command==='review'){stdout(await workspace.reviewSearch({queryId:required(flags,'query')}));return;}
    if(command==='acquire'){stdout(await workspace.acquire({reviewId:required(flags,'review'),operationId}));return;}
    if(command==='resume'){stdout(await workspace.resume({editionId:required(flags,'edition')}));return;}
    if(command==='cancel'){stdout(await workspace.cancel({editionId:required(flags,'edition')}));return;}
    if(command==='edition'){stdout(await workspace.getEdition(required(flags,'edition')));return;}
    if(command==='edition-export'){stdout(await workspace.exportEdition({editionId:required(flags,'edition'),directory:resolve(required(flags,'out'))}));return;}
    if(command==='asset-review'){stdout(await workspace.reviewAsset({editionId:required(flags,'edition'),itemId:required(flags,'item'),assetKey:required(flags,'asset'),maxBytes:number(flags,'max-bytes',16*1024*1024)}));return;}
    if(command==='asset-acquire'){stdout(await workspace.acquireAsset({reviewId:required(flags,'review'),operationId}));return;}
    if(command==='asset-download'){
      stdout(await saveAssetFile(workspace,required(flags,'asset-id'),required(flags,'out'),{overwrite:bool(flags.overwrite)}));return;
    }
    if(command==='decision'){
      const input=flags.input?await readJSON(required(flags,'input')):{editionId:required(flags,'edition'),itemId:required(flags,'item'),status:required(flags,'status'),actor:required(flags,'actor'),note:flags['note-file']?await readFile(resolve(required(flags,'note-file')),'utf8'):String(flags.note||''),...(flags['asset-keys']?{assetKeys:split(required(flags,'asset-keys'))}:{})};
      if(expectedRevision!==undefined)input.expectedRevision=expectedRevision;
      stdout(await workspace.setDecision(input));return;
    }
    if(command==='compare'){stdout(await workspace.compare({leftEditionId:required(flags,'left'),rightEditionId:required(flags,'right')}));return;}
    if(command==='report'){
      const output=await workspace.exportReport({editionId:required(flags,'edition'),format:String(flags.format||'html')});
      stdout(await saveFile(required(flags,'out'),output.bytes,{overwrite:bool(flags.overwrite)}));return;
    }
    if(command==='export'){
      const bundle=await workspace.exportHandover({...(flags.editions?{editionIds:split(required(flags,'editions'))}:{}),includeAssets:bool(flags['include-assets'],true)});
      stdout(await saveFile(required(flags,'out'),JSON.stringify(bundle,null,2)+'\n',{overwrite:bool(flags.overwrite)}));return;
    }
    if(command==='import'){stdout(await workspace.importHandover(await readJSON(required(flags,'input'))));return;}
    throw new Error('Unknown STAC command: '+command+'. Use --help for the complete workflow.');
  }finally{try{await processingController?.close?.();}finally{await workspace.close?.();}}
}
const invoked=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(invoked)runStacCLI().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||'STAC_COMMAND_FAILED',message:error.message||String(error)}})+'\n');process.exitCode=1;});
