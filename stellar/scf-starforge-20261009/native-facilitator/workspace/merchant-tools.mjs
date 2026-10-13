// MIT. Metadata for agent operations on the original native facilitator operator.
const alias = {type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const profile = {type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'};
const sha = {type:'string',pattern:'^[a-f0-9]{64}$'};
const runtime = {type:'string',minLength:1,maxLength:128};
const query = {type:'string',maxLength:4096};
const integer = {type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const object = {type:'object'};
const selection = {operator:alias}, exported = {...selection,exportId:alias};
const read = {readOnly:true,idempotent:true};
const write = {idempotent:false};
const profileSelection = {name:profile,sha256:sha};
const catalogSelection = {runtimeId:runtime,expectedVersion:integer,query};
export const nativeOperatorToolPrefix = 'merchant_native_facilitator';
export function nativeOperatorTools(tool) {
  const define = (suffix,description,properties,required,annotations=read)=>
    tool(nativeOperatorToolPrefix+'_'+suffix,description,properties,required,annotations);
  return [
    define('operators','List host-configured native operator aliases and their labels. Reads configuration metadata.',{},[]),
    define('status','Read the original authenticated operator instance, native runtime, readiness, signer slots and durable catalog queue. Keeps this alias attached to the same operator instance.',selection,['operator']),
    define('profiles','Page immutable native profiles with their exact original names, hashes and summaries. Continue with next as after.',{...selection,after:{type:'string',pattern:'^(?:[A-Za-z0-9][A-Za-z0-9_-]{0,63})?$'},limit:{type:'integer',minimum:1,maximum:100}},['operator']),
    define('profile','Read one complete original native profile, normalized review hash and exact file hash. Secret environment names are configuration references.',{...selection,name:profile},['operator','name']),
    define('review','Review a complete native configuration through its original profile store. Returns its normalized config and review SHA256 before an immutable save.',{...selection,config:object},['operator','config']),
    define('save','Save the exact reviewed native configuration under its immutable profile name and expectedSha256. The original store reconciles an identical existing file.',{...selection,name:profile,config:object,expectedSha256:sha},['operator','name','config','expectedSha256'],write),
    define('probe','Probe the original running runtime, or a saved profile and its exact SHA256. Supply runtimeId alone or name with sha256. Returns the native RPC observation.',{...selection,runtimeId:runtime,...profileSelection},['operator'],{...read,openWorld:true}),
    define('start','Start the selected original profile and exact file SHA256 through the native operator. Retain its returned runtimeId; after a disconnected reply read status before continuing the same operation.',{...selection,...profileSelection,port:{type:'integer',minimum:0,maximum:65535}},['operator','name','sha256'],{...write,openWorld:true}),
    define('stop','Drain the selected original runtimeId through its native operator. Read status to follow accepted SDK work and retained signer ownership.',{...selection,runtimeId:runtime},['operator','runtimeId'],{...write,destructive:true}),
    define('catalog','Read a complete original discovery page at runtimeId and optional expectedVersion. query is the original list/search query; continue the returned offset/cursor and version.',{...selection,...catalogSelection},['operator','runtimeId']),
    define('profile_export','Retain the exact original profile bytes under one stable exportId. Continue the same ID and exact profile selection after interruption; complete receiving reopens its original manifest.',{...exported,...profileSelection},['operator','exportId','name','sha256'],write),
    define('catalog_export','Stream every matching catalog resource at the selected runtime and expectedVersion into one retained export, together with its exact original native profile. A completed same-ID request reopens the same bytes after agent restart.',{...exported,...catalogSelection},['operator','exportId','runtimeId','expectedVersion'],write),
    define('exports','Page this alias’s retained profile/catalog receiving operations, including their original manifest hashes and unfinished IDs.',{...selection,after:{type:'string',pattern:'^(?:[a-z0-9][a-z0-9_-]{0,63})?$'},limit:{type:'integer',minimum:1,maximum:100}},['operator']),
    define('manifest','Inspect the original completion manifest and its exact byte count/SHA256 for one retained receiving export.',exported,['operator','exportId']),
    define('file','Read the manifest, exact native profile or complete catalog through the original retained-file reader. Continue with the same exportId, file, manifest SHA256, readId, file SHA256 and nextOffset; omit an expired readId to resume original bytes.',{...exported,
      file:{type:'string',enum:['native-operator-export.json','profile.json','catalog.json']},
      expectedManifestSha256:sha,expectedSha256:sha,readId:{type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'},
      offset:integer,limit:{type:'integer',minimum:1,maximum:196608}},['operator','exportId','file','expectedManifestSha256','expectedSha256']),
    define('file_release','Release this original export’s retained file read. Its completed receiving files remain available through the manifest.',{...exported,readId:{type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'}},['operator','exportId','readId'],{idempotent:true}),
    define('disconnect','Finish accepted client calls and close this alias’s retained reads. A later call explicitly attaches its current host-declared original connection.',selection,['operator'],{idempotent:true}),
  ];
}
