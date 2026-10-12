// MIT. Original complete live collection and analytical handover commands.
import { constants } from 'node:fs';
import { open, lstat, realpath, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readRequestFile } from '../../../sf88-operator-buyer-cli/request-body.mjs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, readPackage } from './client.mjs';
import { json } from './config.mjs';
import { COLLECTION_INPUT_SCHEMA, receiveCollection, openCollection, restoreCollection,
  readCollectionRows, collectionAnalysisMapping } from './collection.mjs';

const HELP = 'OData live collection customer\n\n'+
  'receive --package DIRECTORY --input exchanges.json --out PRIVATE_DIRECTORY\n'+
  'inspect --directory DIRECTORY\n'+
  'restore --manifest ORIGINAL_ANALYSIS_SOURCE.json --out PRIVATE_DIRECTORY [--sha256 SHA256]\n'+
  'rows --directory DIRECTORY [--offset 0 --limit 100]\n'+
  'analysis-mapping --directory DIRECTORY --source REGISTERED_NAME --revision NUMBER --out mapping.json\n\n'+
  'The installed odata-live command prefixes these commands with collection-, except\n'+
  'receive, which is odata-live collection. Select the complete ordered original\n'+
  'request/response chain. Paths in exchanges.json are relative to that file.\n'+
  'Repeating the same receive or restore continues its existing immutable output.\n'+
  'Use --allow-loopback true only for an original local supplier package.\n';

function options(args) {
  const [command,...rest]=args,result={};
  for(let i=0;i<rest.length;i+=2){
    const name=rest[i];
    if(typeof name!=='string'||!name.startsWith('--')||Object.hasOwn(result,name.slice(2))||
      !rest[i+1]||rest[i+1].startsWith('--'))throw new TypeError('Each named option requires one value.');
    result[name.slice(2)]=rest[i+1];
  }
  return {command,options:result};
}
function required(input,name) {if(!input[name])throw new TypeError('--'+name+' is required.');return input[name];}
function only(input,names) {if(Object.keys(input).some(key=>!names.includes(key)))throw new TypeError('Unknown collection option. Use --help.');}
function integer(value,fallback) {
  if(value===undefined)return fallback;
  if(!/^(?:0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw new TypeError('Choose an explicit nonnegative integer.');
  return Number(value);
}
function summary(result) {
  return {schema:result.schema,directory:result.directory,title:result.title,operation:result.operation,
    entitySet:result.entitySet,metadataSha256:result.metadataSha256,sourceBinding:result.sourceBinding,
    query:result.query,queryFingerprint:result.queryFingerprint,keyFields:result.keyFields,
    rows:result.rows,pages:result.pageCount,completion:result.completion,reportedCounts:result.reportedCounts,
    countConsistent:result.countConsistent,acquisition:result.acquisition,mapping:result.mapping,
    manifestSha256:result.manifestSha256,analysis:result.analysis,analysisProjection:result.analysisProjection,...(result.restoredFrom?{restoredFrom:result.restoredFrom}:{})};
}
async function saveMapping(path,value) {
  const raw=Buffer.from(json(value)),target=resolve(path),parent=dirname(target),info=await lstat(parent);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||await realpath(parent)!==parent||
    typeof process.getuid==='function'&&info.uid!==process.getuid())throw new TypeError('Choose an owned private mapping directory.');
  const temporary=target+'.'+randomUUID()+'.partial',file=await open(temporary,
    constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {
    await file.writeFile(raw);await file.sync();await file.close();
    try{await link(temporary,target);}catch(error){
      if(error.code!=='EEXIST')throw error;
      if(!(await readRequestFile(target,1048576,{privateFile:true})).equals(raw))
        throw new TypeError('The existing mapping file selects a different source.');
    }
    const directory=await open(parent,constants.O_RDONLY|constants.O_DIRECTORY);
    try{await directory.sync();}finally{await directory.close();}
  }finally{await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {path:target,source:value.source,sourceRevision:value.source_revision,columns:value.mapping.columns.length};
}
export async function main(args=process.argv.slice(2)) {
  if(!args.length||args.includes('--help')){process.stdout.write(HELP);return;}
  const {command,options:o}=options(args);let result;
  if(command==='receive'){
    only(o,['package','input','out','allow-loopback']);
    if(o['allow-loopback']!==undefined&&!['true','false'].includes(o['allow-loopback']))throw new TypeError('Choose true or false for --allow-loopback.');
    const inputPath=resolve(required(o,'input')),input=await readJson(inputPath,16777216);
    if(input?.schema!==COLLECTION_INPUT_SCHEMA||Object.keys(input).some(key=>!['schema','operation','title','fields','limits','exchanges'].includes(key))||
      !Array.isArray(input.exchanges))throw new TypeError('Choose an original complete collection input.');
    const exchanges=input.exchanges.map(exchange=>{
      if(!exchange||typeof exchange!=='object'||Array.isArray(exchange))throw new TypeError('Select each original exchange.');
      return Object.fromEntries(Object.entries(exchange).map(([key,path])=>{
        if(!['requestPath','responsePath','buyerConfigPath','buyerResultPath'].includes(key)||typeof path!=='string'||!path)
          throw new TypeError('Select the original request/response and optional buyer files.');
        return [key,resolve(dirname(inputPath),path)];
      }));
    });
    const allowLoopback=o['allow-loopback']==='true',prepared=await readPackage(required(o,'package'),{allowLoopback});
    result=summary(await receiveCollection(prepared,{operation:input.operation,title:input.title,fields:input.fields,
      limits:input.limits,exchanges,directory:required(o,'out'),allowLoopback}));
  }else if(command==='inspect'){
    only(o,['directory']);result=summary(await openCollection(required(o,'directory')));
  }else if(command==='restore'){
    only(o,['manifest','out','sha256']);result=summary(await restoreCollection({sourceManifest:required(o,'manifest'),
      directory:required(o,'out'),expectedSha256:o.sha256}));
  }else if(command==='rows'){
    only(o,['directory','offset','limit']);result=await readCollectionRows(required(o,'directory'),
      {offset:integer(o.offset,0),limit:integer(o.limit,100)});
  }else if(command==='analysis-mapping'){
    only(o,['directory','source','revision','out']);
    const collection=await openCollection(required(o,'directory')),mapping=collectionAnalysisMapping(collection,
      {source:required(o,'source'),sourceRevision:integer(required(o,'revision'))});
    result=await saveMapping(required(o,'out'),mapping);
  }else throw new TypeError('Unknown collection command. Use --help.');
  process.stdout.write(json(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(json({error:error.code??'ODATA_COLLECTION_COMMAND_FAILED',message:error.message}));process.exitCode=1;});
