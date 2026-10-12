// MIT. The complete original WFS customer workspace in installed Applications.
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { APPLICATION_PROVIDER_SCHEMA, applicationField as field, applicationPreparation,
  observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { need,plain } from './model.mjs';
import { wfsLoopbackJson,wfsLoopbackUrl } from './loopback.mjs';

const ROOT='stellar/scf-starforge-20261009/sf30-seller-sdk/wfs/';
const STARTUP='stellar-forge.wfs-workspace-startup.v1';
export function wfsApplication(common=[]) {
  return {id:'wfs-geoserver',command:'wfs',title:'WFS feature workspace',terminal:true,
    requiredSource:ROOT+'launch.mjs',
    description:'Discover WFS2 services, acquire complete feature orders, review native GIS mappings, export or receive GeoPackage/Shapefile deliveries, compare source editions and reopen customer datasets.',
    fields:[
      field('workspaceDirectory','Original feature project','path',true,'Select an initialized WFS project or a received customer project.'),
      field('sourceAuthConfig','Private source credential references','path',false,'Existing source origins and environment references for Basic, Bearer or API key authorization.'),
      field('buyerConfig','Original buyer configuration','path',false,'Existing private SF88 runtime, payer and intent journal for approval, paid acquisition and recovery.'),
      field('facilitator','Configured facilitator URL','text',false,'Original HTTPS facilitator; leave empty for challenge-only merchant serving.'),
      field('allowLocalFacilitator','Allow configured local facilitator','boolean',false,'Explicitly allow the original http://127.0.0.1 service.'),
      field('merchantPort','Routed merchant port','port',false,'Use the loopback port routed by the publication HTTPS origin. Zero chooses an available port.'),
      field('sourcePython','Source Python executable','path',false,'Python 3.11+ with the installed buyer package. Native vector work uses Fiona/GDAL in this same executable; defaults to the selected terminal Python.'),
      field('terminalPython','Terminal Python executable','path',false,'Defaults to /usr/bin/python3; carries the original native buyer approval.'),
      ...common]};
}
export async function prepareWfsApplication(settings,{inputPath,runtimeDirectory}={}) {
  const workspace=await inputPath(settings.workspaceDirectory,'directory',false,true);
  const runtime=await inspectMerchantRuntime(resolve(runtimeDirectory),{load:false,source:false});
  const launch=join(runtime.sourceRoot,ROOT+'launch.mjs');
  const inputs=[workspace,await inputPath(launch,'file'),await inputPath(join(runtime.sourceRoot,ROOT+'workspace.mjs'),'file'),
    await inputPath(join(runtime.sourceRoot,ROOT+'cli.mjs'),'file')];
  if(settings.sourceAuthConfig)inputs.push(await inputPath(settings.sourceAuthConfig,'file',false,true));
  if(settings.buyerConfig)inputs.push(await inputPath(settings.buyerConfig,'file',false,true));
  const python=await inputPath(settings.sourcePython??settings.terminalPython??'/usr/bin/python3','file');
  inputs.push(python);
  const original=await import(pathToFileURL(launch).href);
  const binding=await original.inspectWfsWorkspaceBinding({directory:workspace.path,buyerConfig:settings.buyerConfig,sourceAuthConfig:settings.sourceAuthConfig,
    facilitator:settings.facilitator,allowLocalFacilitator:settings.allowLocalFacilitator===true,merchantPort:settings.merchantPort??0});
  need(plain(binding)&&binding.schema==='stellar-forge.wfs-workspace-binding.v1'&&binding.directory===workspace.path&&
    /^[a-f0-9-]{36}$/.test(binding.projectId??'')&&/^[a-f0-9]{64}$/.test(binding.sha256??''),'The original WFS project binding changed.');
  const args=['serve','--project',binding.directory,'--expected-binding-sha256',binding.sha256,
    '--merchant-port',String(binding.merchantPort),'--python',python.path];
  if(binding.sourceAuthConfig)args.push('--source-auth',binding.sourceAuthConfig.path);
  if(binding.buyerConfig)args.push('--buyer-config',binding.buyerConfig.path);
  if(binding.facilitator)args.push('--facilitator',binding.facilitator);
  if(binding.allowLocalFacilitator)args.push('--allow-local-facilitator');
  return {args,inputs};
}
function argument(request,name,required=true) {
  const indices=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(!indices.length&&!required)return undefined;
  need(indices.length===1&&typeof request.args[indices[0]+1]==='string','The original application arguments changed.');
  return request.args[indices[0]+1];
}
export async function wfsStartup(request,text) {
  if(request.command!=='wfs'||!Array.isArray(request.args)||request.args[0]!=='serve'||typeof text!=='string'||text.length>16384||!text.startsWith('{'))return null;
  let ready;try{ready=JSON.parse(text);}catch{return null;}
  if(!plain(ready)||ready.schema!==STARTUP||ready.state!=='LISTENING')return null;
  const directory=resolve(argument(request,'--project')),expected=argument(request,'--expected-binding-sha256'),
    port=argument(request,'--port',false)??'0',merchantPort=argument(request,'--merchant-port');
  need(/^[a-f0-9]{64}$/.test(expected)&&/^(0|[1-9]\d*)$/.test(port)&&Number(port)<=65535&&
    /^(0|[1-9]\d*)$/.test(merchantPort)&&Number(merchantPort)<=65535&&ready.binding?.directory===directory&&
    ready.binding?.sha256===expected&&ready.binding?.merchantPort===Number(merchantPort)&&
    /^[a-f0-9-]{36}$/.test(ready.binding?.projectId??'')&&/^[a-f0-9-]{36}$/.test(ready.instanceId??''),
    'The original WFS startup binding changed.');
  const url=wfsLoopbackUrl(ready.url);
  need(port==='0'||Number(port)===(url.port===''?80:Number(url.port)),'The original selected browser port changed.');
  const live=await wfsLoopbackJson({url:ready.url,path:'/api/launch',maxBytes:16384,timeout:5000});
  need(live?.schema===STARTUP&&live.state==='LISTENING'&&live.instanceId===ready.instanceId&&
    live.binding?.sha256===expected&&live.binding?.directory===directory&&live.binding?.projectId===ready.binding.projectId&&
    live.binding?.merchantPort===Number(merchantPort)&&live.buyerConfigured===Boolean(ready.binding.buyerConfig)&&live.sourceAuthConfigured===Boolean(ready.binding.sourceAuthConfig),
    'The live application differs from the original selected project.');
  return {url:url.href,original:{schema:STARTUP,directory,projectId:live.binding.projectId,bindingSha256:expected,
    instanceId:live.instanceId,buyerConfigured:live.buyerConfigured,merchantPort:live.binding.merchantPort,startedAt:live.startedAt}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'wfs-geoserver',order:366,
  catalog({common}){return[wfsApplication(common)];},
  async prepare(type,settings,context){
    const prepared=applicationPreparation(settings,context.inputPath),original=await prepareWfsApplication(settings,context);
    prepared.args.push(...original.args);prepared.inputs.push(...original.inputs);
    return {args:prepared.args,inputs:prepared.inputs,createDirectories:prepared.createDirectories};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='wfs';},
  createObserver(request,directory){return observeApplicationStartup(request,directory,text=>{
    if(!text.startsWith('{')||!text.includes('"schema":"'+STARTUP+'"'))return null;
    return ()=>wfsStartup(request,text);
  });}
};
