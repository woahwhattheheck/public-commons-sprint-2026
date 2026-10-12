// MIT. Selected original case/pricing paths belong to the Research launcher.
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {readResearchHostFile} from '../workspace-files.mjs';
import {parseJson,digest} from '../../node/store.mjs';
import {QUOTE_HOST_SCHEMA,fields,alias,text,need,copy,fingerprint} from './contracts.mjs';
export function quotePath(value,base=process.cwd()){
 need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\0\r\n]/.test(value),
  'RESEARCH_QUOTE_HOST_PATH_REQUIRED');
 const path=resolve(base,value);need(path!=='/','RESEARCH_QUOTE_HOST_PATH_REQUIRED');return path;
}
export async function readResearchQuoteConfiguration(file,{directory}={}){
 const fallback=join(quotePath(directory),'cases');
 if(file===null||file===undefined)return {schema:QUOTE_HOST_SCHEMA,file:null,sha256:null,casesDirectory:fallback,pricing:{}};
 file=quotePath(file);const body=await readResearchHostFile(file,1024*1024,{privateFile:true}),input=parseJson(body);
 fields(input,['schema','casesDirectory','pricing'],['schema']);
 need(input.schema===QUOTE_HOST_SCHEMA,'RESEARCH_QUOTE_HOST_CONFIGURATION_REQUIRED');
 const result={schema:QUOTE_HOST_SCHEMA,file,sha256:digest(body),
  casesDirectory:input.casesDirectory===undefined?fallback:quotePath(input.casesDirectory,dirname(file)),pricing:{}};
 const entries=input.pricing??{};
 fields(entries,Object.keys(entries),[]);
 need(Object.keys(entries).length<=16,'RESEARCH_QUOTE_PRICING_PROFILE_LIMIT');
 for(const [key,row]of Object.entries(entries)){
  alias(key);fields(row,['label','config','directory','snapshot','history','nativeOutbox','sourcePackage','releaseStore','releaseRuntime'],
   ['config','directory']);
  need(Boolean(row.snapshot)!==Boolean(row.history),'RESEARCH_QUOTE_ORIGINAL_OBSERVATION_REQUIRED');
  const item={label:text(row.label??key,160)};
  for(const name of ['config','directory','snapshot','history','nativeOutbox','sourcePackage','releaseStore'])
   if(row[name]!==undefined)item[name]=quotePath(row[name],dirname(file));
  if(row.releaseRuntime!==undefined){
   need(row.releaseRuntime!==null&&typeof row.releaseRuntime==='object'&&!Array.isArray(row.releaseRuntime),
    'RELEASE_RUNTIME_REQUIRED');
   item.releaseRuntime=copy(row.releaseRuntime);
  }
  result.pricing[key]=item;
 }
 return result;
}
export async function quoteDirectoryIdentity(path){
 const stat=await lstat(path);
 need(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(path)===path,
  'RESEARCH_QUOTE_ORIGINAL_DIRECTORY_REQUIRED');
 return {path,device:String(stat.dev),inode:String(stat.ino)};
}
export async function assertQuoteDirectory(identity){
 const now=await quoteDirectoryIdentity(identity.path);
 need(fingerprint(now)===fingerprint(identity),'RESEARCH_QUOTE_ORIGINAL_DIRECTORY_CHANGED',409);return now;
}
export async function selectQuotePricing(configuration,key){
 alias(key);const declared=configuration.pricing[key];
 need(declared,'RESEARCH_QUOTE_PRICING_NOT_CONFIGURED');
 const {label,...options}=declared;
 const directory=await quoteDirectoryIdentity(options.directory),files=[];
 for(const name of ['config','snapshot','history'])if(options[name]){
  const body=await readResearchHostFile(options[name],name==='config'?16*1024*1024:128*1024*1024,{privateFile:true});
  files.push({kind:name,path:options[name],bytes:body.length,sha256:digest(body)});
 }
 const binding={profile:key,label,options:copy(options),directory,files};
 return {binding,bindingSha256:fingerprint(binding),options:copy(options)};
}
export async function openQuotePricing(configuration,key){
 const selected=await selectQuotePricing(configuration,key);
 const {openWorkspace}=await import('../../../sf97-merchant-revenue-ops/workspace/model.mjs');
 const {openPlanningWorkspace}=await import('../../../sf97-merchant-revenue-ops/planning/workspace.mjs');
 const {openTariffWorkspace}=await import('../../../sf97-merchant-revenue-ops/tariffs/workspace.mjs');
 const model=await openWorkspace(selected.options);
 const planning=await openPlanningWorkspace({model,directory:selected.options.directory});
 const tariffs=await openTariffWorkspace({model,directory:selected.options.directory});
 return {...selected,model,planning,tariffs};
}
export function quoteConfigurationView(configuration,{workspaceId,casesIdentity,commercialWorkspaceId,merchants}){
 return {schema:QUOTE_HOST_SCHEMA,workspaceId,configurationFile:configuration.file,
  cases:{directory:configuration.casesDirectory,workspaceId:commercialWorkspaceId,identity:copy(casesIdentity)},
  pricing:Object.entries(configuration.pricing).map(([id,value])=>({id,...copy(value)})),merchants};
}
