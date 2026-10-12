import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {check,objectDigest,verifyManifest,fileIdentity,safeRelative} from './files.mjs';
export const UPSTREAM={repository:'lightdash/lightdash',commit:'91e610898395e6659841a321a0cee31cfcac8ae8',version:'2.568.0',example:'examples/full-jaffle-shop-demo',exampleTree:'aeb0d9a2ca10e24b30641c91b187b4efcae57324',exampleFiles:189,exampleBytes:28190932};
export const ACTIONS={
 'inspect':{title:'Inspect the native project',mode:'read'},
 'run-chart':{title:'Run the reviewed native chart and retain its query results',mode:'provider-read-job'},
 'dbt-deps':{title:'Resolve original dbt dependencies',mode:'local'},
 'dbt-build':{title:'Build the selected dbt warehouse models and seeds',mode:'warehouse-write'},
 'compile':{title:'Compile the selected Lightdash project',mode:'read'},
 'start-preview':{title:'Create or update this workspace’s named preview',mode:'provider-write'},
 'stop-preview':{title:'Delete this workspace’s owned preview',mode:'provider-write'},
 'validate':{title:'Validate the selected project with the original scheduler',mode:'provider-job'},
 'deploy':{title:'Deploy the reviewed source edition',mode:'provider-write'},
 'download':{title:'Download native charts, dashboards and spaces',mode:'read'},
 'upload':{title:'Upload reviewed native content with a prior target backup',mode:'provider-write'}
};
export function describeEngine(){return {schema:'lightdash-commissioning.engine.v1',upstream:UPSTREAM,nodeMajor:24,platform:'linux',dependencies:['Python 3 with POSIX flock','original npm/source-built @lightdash/cli 2.568.0','original dbt executable and its selected adapter'],actions:ACTIONS,config:'Original os.homedir()/.config/lightdash/config.yaml; supported environment overrides; no alternate config-root flag.',contentScope:{charts:true,dashboards:true,spaces:true,optionalResources:false,organizationBackup:false},recovery:'Same-operation native readback first; uncertain mutations require an explicit reviewed continuation.'};}
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,ENV=/^[A-Z_][A-Z0-9_]{0,127}$/;
const blockedEnv=new Set(['HOME','CODEX_HOME','PATH','NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONHOME','LD_PRELOAD','LD_LIBRARY_PATH']);
const strict=(o,keys,label)=>{check(o&&typeof o==='object'&&!Array.isArray(o),'LIGHTDASH_INPUT',label+' must be an object.');for(const k of Object.keys(o))check(keys.includes(k),'LIGHTDASH_INPUT','Unknown '+label+' field: '+k);};
const id=(x,label)=>{check(typeof x==='string'&&ID.test(x),'LIGHTDASH_INPUT','Invalid '+label+'.');return x;};
const uuid=(x,label)=>{check(typeof x==='string'&&UUID.test(x),'LIGHTDASH_INPUT','Use the exact native UUID for '+label+'.');return x.toLowerCase();};
const envName=x=>{check(typeof x==='string'&&ENV.test(x)&&!blockedEnv.has(x),'LIGHTDASH_ENV','Invalid environment reference.');return x;};
const text=(x,label,max=256)=>{check(typeof x==='string'&&x.length>0&&x.length<=max&&!/[\0\r\n]/.test(x),'LIGHTDASH_INPUT','Invalid '+label+'.');return x;};
const list=(x,label)=>{if(x===undefined)return[];check(Array.isArray(x)&&x.length<=100,'LIGHTDASH_INPUT','Invalid '+label+'.');return x.map(v=>text(v,label,512));};
async function executable(x,label){check(typeof x==='string'&&path.isAbsolute(x),'LIGHTDASH_RUNTIME','Use an absolute '+label+' path.');const file=await realpath(x);return {path:file,...await fileIdentity(file)};}
export async function normalizeConnection(value){
 strict(value,['id','origin','projectUuid','tokenEnv','proxyAuthorizationEnv','allowHttp','runtime','environment','source','profiles'],'connection');
 const u=new URL(value.origin);check(!u.username&&!u.password&&!u.hash&&!u.search&&u.pathname==='/'&&(u.protocol==='https:'||(u.protocol==='http:'&&value.allowHttp===true)),'LIGHTDASH_ORIGIN','Use an exact HTTP(S) origin; plain HTTP needs explicit private-host selection.');
 strict(value.runtime,['node','cliEntry','python','dbt'],'runtime');
 const runtime={};for(const k of ['node','cliEntry','python','dbt'])runtime[k]=await executable(value.runtime[k],k);
 const pkgPath=path.resolve(path.dirname(runtime.cliEntry.path),'..','package.json'),pkg=JSON.parse(await readFile(pkgPath));
 check(pkg.name==='@lightdash/cli'&&pkg.version===UPSTREAM.version&&path.basename(runtime.cliEntry.path)==='index.js','LIGHTDASH_CLI_VERSION','Select the original installed @lightdash/cli 2.568.0 dist/index.js.');
 runtime.package={file:pkgPath,...await fileIdentity(pkgPath),name:pkg.name,version:pkg.version};
 runtime.modules={};for(const name of ['config','credentials','handlers/dbt/apiClient','handlers/compile','handlers/deploy','handlers/preview','handlers/validate','handlers/download','handlers/sourceSelection','handlers/runChart','handlers/asyncQuery']){
  const file=path.join(path.dirname(runtime.cliEntry.path),name+'.js');runtime.modules[name]={file,...await fileIdentity(file)};
 }
 const environment={};for(const[k,v]of Object.entries(value.environment??{})){envName(k);check(!k.startsWith('LIGHTDASH_')&&!k.startsWith('LDW_')&&!blockedEnv.has(k),'LIGHTDASH_ENV','Native runtime variables cannot be replaced through warehouse bindings.');environment[k]=envName(v);}
 let source=null;if(value.source!==undefined&&value.source!==null){strict(value.source,['name','uuid'],'source');source={name:text(value.source.name,'dbt source name'),uuid:uuid(value.source.uuid,'dbt source')};}
 let profiles=null;if(value.profiles){strict(value.profiles,['directory','manifestFile','manifestSha256'],'host profiles');const verified=await verifyManifest(value.profiles);check(verified.files.some(f=>f.path==='profiles.yml'),'LIGHTDASH_DBT_PROFILE','Private host profiles require profiles.yml.');profiles={directory:path.resolve(value.profiles.directory),manifestFile:path.resolve(value.profiles.manifestFile),manifestSha256:value.profiles.manifestSha256,files:verified.files};}
 return {profiles,id:id(value.id,'connection ID'),origin:u.origin,projectUuid:uuid(value.projectUuid,'project'),tokenEnv:envName(value.tokenEnv),proxyAuthorizationEnv:value.proxyAuthorizationEnv?envName(value.proxyAuthorizationEnv):null,allowHttp:value.allowHttp===true,environment,source,runtime};
}
export async function normalizeEdition(value,connection){
 strict(value,['id','directory','manifestFile','manifestSha256','projectDir','profilesDir','profile','target','sourceSha256'],'edition');
 const verified=await verifyManifest(value);const relativeDirectory=v=>v==='.'?'.':safeRelative(v);const projectDir=relativeDirectory(value.projectDir),profilesDir=value.profilesDir?relativeDirectory(value.profilesDir):null;
 const member=(dir,file)=>dir==='.'?file:dir+'/'+file;
 check(verified.files.some(f=>f.path===member(projectDir,'dbt_project.yml'))&&(connection?.profiles||verified.files.some(f=>f.path===member(profilesDir,'profiles.yml'))),'LIGHTDASH_DBT_SOURCE','The complete edition must include its actual dbt_project.yml and environment-backed profiles.yml.');
 if(value.sourceSha256!==undefined)check(/^[a-f0-9]{64}$/.test(value.sourceSha256),'LIGHTDASH_EDITION','Invalid source SHA256.');
 return {sourceSha256:value.sourceSha256??value.manifestSha256,id:id(value.id,'edition ID'),directory:path.resolve(value.directory),manifestFile:path.resolve(value.manifestFile),manifestSha256:value.manifestSha256,files:verified.files,bytes:verified.bytes,projectDir,profilesDir,profile:text(value.profile,'dbt profile'),target:text(value.target,'dbt target')};
}
const allowedInput=['resumeOf','select','exclude','vars','threads','name','expiresInHours','skipCopyContent','warehouseCredentials','previewProjectUuid','startOperationId','projectUuid','severity','only','content','applySpaceAccess','chartPath','limit','pageSize'];
function normalizeInput(action,input,connection){
 strict(input,allowedInput,'operation input');const x={};
 const common=new Set(['resumeOf']),per={
 inspect:[], 'run-chart':['projectUuid','startOperationId','chartPath','limit','pageSize'], 'dbt-deps':[], 'dbt-build':['select','exclude','vars','threads'],compile:['select','exclude','vars','threads'],
 'start-preview':['select','exclude','vars','threads','name','expiresInHours','skipCopyContent','warehouseCredentials','startOperationId','previewProjectUuid'],
 'stop-preview':['name','previewProjectUuid','startOperationId'],validate:['select','exclude','vars','threads','projectUuid','startOperationId','severity','only'],
 deploy:['select','exclude','vars','threads','projectUuid','startOperationId'],
 download:['projectUuid','startOperationId'],upload:['projectUuid','startOperationId','content','applySpaceAccess']};
 for(const k of Object.keys(input))check(common.has(k)||per[action].includes(k),'LIGHTDASH_INPUT','This action does not accept '+k+'.');
 if(input.resumeOf)x.resumeOf=id(input.resumeOf,'prior operation ID');
 if(['dbt-build','compile','start-preview','validate','deploy'].includes(action)){
  x.select=list(input.select,'dbt selection');x.exclude=list(input.exclude,'dbt exclusion');
  x.vars=input.vars??{};check(x.vars&&typeof x.vars==='object'&&!Array.isArray(x.vars)&&JSON.stringify(x.vars).length<=65536,'LIGHTDASH_INPUT','dbt vars must be a bounded JSON object.');
  x.threads=input.threads??2;check(Number.isSafeInteger(x.threads)&&x.threads>=1&&x.threads<=8,'LIGHTDASH_INPUT','Use 1–8 dbt threads.');
 }
 if(['start-preview','stop-preview'].includes(action))x.name=text(input.name,'preview name',100);
 if(action==='start-preview'){
  x.expiresInHours=input.expiresInHours??24;check(Number.isSafeInteger(x.expiresInHours)&&x.expiresInHours>=1&&x.expiresInHours<=720,'LIGHTDASH_INPUT','Preview expiration must be 1–720 hours.');
  x.skipCopyContent=input.skipCopyContent===true;x.warehouseCredentials=input.warehouseCredentials??'copy-upstream';check(['copy-upstream','profiles'].includes(x.warehouseCredentials),'LIGHTDASH_INPUT','Choose native upstream credentials or the selected profile credentials.');
 }
 if(input.startOperationId)x.startOperationId=id(input.startOperationId,'preview creation operation');
 if(input.previewProjectUuid)x.previewProjectUuid=uuid(input.previewProjectUuid,'owned preview');
 if(action==='stop-preview')check(x.startOperationId&&x.previewProjectUuid,'LIGHTDASH_PREVIEW_OWNER','Stopping requires the original start operation and its exact preview UUID.');
 if(['validate','deploy','download','upload','run-chart'].includes(action)){
  x.projectUuid=input.projectUuid?uuid(input.projectUuid,'target project'):connection.projectUuid;
  if(x.projectUuid!==connection.projectUuid)check(x.startOperationId,'LIGHTDASH_PREVIEW_OWNER','A preview target requires its original start operation.');
 }
 if(action==='validate'){x.severity=input.severity??'error';check(['error','warning'].includes(x.severity),'LIGHTDASH_INPUT','Choose native validation severity.');x.only=input.only??['tables','charts','dashboards'];check(Array.isArray(x.only)&&x.only.length>0&&x.only.every(v=>['tables','charts','dashboards','apps'].includes(v)),'LIGHTDASH_INPUT','Invalid native validation target.');}
 if(action==='run-chart'){
  x.chartPath=safeRelative(input.chartPath);check(/\.ya?ml$/i.test(x.chartPath),'LIGHTDASH_CHART','Select the actual metric-query chart YAML in this immutable edition.');
  x.limit=input.limit??500;x.pageSize=input.pageSize??x.limit;
  check(Number.isSafeInteger(x.limit)&&x.limit>=1&&x.limit<=5000&&Number.isSafeInteger(x.pageSize)&&x.pageSize>=x.limit&&x.pageSize<=5000,'LIGHTDASH_CHART_LIMIT','Select 1–5000 rows and a native result page large enough for that reviewed limit.');
 }
 if(action==='upload'){
  strict(input.content,['directory','manifestFile','manifestSha256','sourceProjectUuid','sourceOperationId','sourceEditionId'],'content');
  check(path.isAbsolute(input.content.directory)&&path.isAbsolute(input.content.manifestFile),'LIGHTDASH_CONTENT','Use absolute retained content paths.');
  check(Boolean(input.content.sourceOperationId)!==Boolean(input.content.sourceEditionId),'LIGHTDASH_CONTENT','Bind content to exactly one original download operation or the selected source edition.');
  x.content={directory:path.resolve(input.content.directory),manifestFile:path.resolve(input.content.manifestFile),manifestSha256:input.content.manifestSha256,sourceProjectUuid:uuid(input.content.sourceProjectUuid,'content source project'),...(input.content.sourceOperationId?{sourceOperationId:id(input.content.sourceOperationId,'content source operation')}:{sourceEditionId:id(input.content.sourceEditionId,'content source edition')})};x.applySpaceAccess=input.applySpaceAccess===true;
 }
 return x;
}
export async function planOperation({operationId,action,connection,edition,input={}}){
 id(operationId,'operation ID');check(ACTIONS[action],'LIGHTDASH_ACTION','Select an implemented original native action.');
 const c=await normalizeConnection(connection),e=await normalizeEdition(edition,c),i=normalizeInput(action,input,c);
 if(action==='run-chart')check(e.files.some(f=>f.path===i.chartPath),'LIGHTDASH_CHART','Chart does not exist in the selected immutable edition.');
 if(i.content){const verified=await verifyManifest(i.content);i.content.files=verified.files;i.content.bytes=verified.bytes;}
 const effects={mode:ACTIONS[action].mode,projectUuid:i.projectUuid??c.projectUuid,sourceEdition:e.id,sourceSha256:e.manifestSha256,warehouseWrites:action==='dbt-build',storesWarehouseCredentials:action==='start-preview'&&i.warehouseCredentials==='profiles',deletesOwnedPreview:action==='stop-preview',contentScope:['download','upload'].includes(action)?'All native charts, dashboards and spaces visible to the selected account; optional and organization resources excluded.':null,spaceAccessChanges:action==='upload'&&i.applySpaceAccess,backupBeforeWrite:action==='upload'};
 const commands={action,nativeCommand:['dbt-deps','dbt-build'].includes(action)?['dbt',action.slice(4)]:[action],projectSelection:'Explicit UUID; named preview uses original LIGHTDASH_PROJECT upstream binding.',dbtProject:e.projectDir,dbtProfiles:e.profilesDir,profile:e.profile,target:e.target};
 const body={schema:'lightdash-commissioning.operation.v1',operationId,action,upstream:UPSTREAM,connection:c,edition:e,input:i,effects,commands};
 return {...body,digest:objectDigest(body)};
}
export function validatePlan(operation){const {digest:expected,...body}=operation;check(operation.schema==='lightdash-commissioning.operation.v1'&&ACTIONS[operation.action]&&objectDigest(body)===expected,'LIGHTDASH_PLAN_CHANGED','The reviewed native operation changed.');return operation;}
