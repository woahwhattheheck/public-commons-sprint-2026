// MIT. The maintained Applications controller launches the customer desk over its original runtime.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../../sf46-release/runtime-package.mjs';
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../runtime-workspace/application-provider.mjs';
import { absolute, need, plain } from '../files.mjs';

const SOURCE='stellar/scf-starforge-20261009/distribution/ruby-runtime/customer';
const SCHEMA='stellar-forge.ruby-customer-workspace-startup.v1';
const FILES=['source.mjs','model.mjs','cli.mjs','server.mjs','launch.mjs','application-provider.mjs',
  'browser.mjs','panel.mjs','index.html','runtime-browser.mjs','runtime-style.css','customer.css','README.md'];
function option(args,name,optional=false) {
  need(Array.isArray(args),'APPLICATION_RUBY_CUSTOMER_ARGUMENTS_CHANGED');
  const indexes=args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&indexes.length===0)return undefined;
  need(indexes.length===1&&typeof args[indexes[0]+1]==='string','APPLICATION_RUBY_CUSTOMER_ARGUMENTS_CHANGED');
  return args[indexes[0]+1];
}
async function launchModel(sourceRoot) {
  const source=await import(pathToFileURL(join(absolute(sourceRoot),SOURCE,'launch.mjs')).href);
  need(typeof source.inspectRubyCustomerLaunch==='function','APPLICATION_RUBY_CUSTOMER_SOURCE_REQUIRED');
  return source;
}
async function selected(request) {
  need(request.command==='ruby-customer-workspace'&&request.args?.[0]==='serve','APPLICATION_RUBY_CUSTOMER_ARGUMENTS_CHANGED');
  const directory=absolute(option(request.args,'--directory'));
  const sourceRoot=join(absolute(request.releaseDirectory),'source');
  const model=await launchModel(sourceRoot);
  return model.inspectRubyCustomerLaunch({directory,sourceDirectory:join(sourceRoot,SOURCE)});
}
async function startup(request,line) {
  let value;try{value=JSON.parse(line);}catch{return null;}
  if(!plain(value)||value.schema!==SCHEMA)return null;
  const expected=await selected(request);
  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_RUBY_CUSTOMER_STARTUP_CHANGED');}
  const requestedPort=Number(option(request.args,'--port',true)??8475),port=Number(url.port||80);
  need(value.status==='RUBY_CUSTOMER_WORKSPACE_READY'&&value.directory===expected.workspace.directory&&
    value.workspaceIdentity===expected.workspaceIdentity&&value.settingsSha256===expected.workspace.settingsSha256&&
    value.sourceSha256===expected.sourceSha256&&value.sourceDirectory===expected.sourceDirectory&&
    url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&
    url.pathname==='/'&&/^#token=[a-f0-9]{64}$/.test(url.hash)&&port>0&&port<=65535&&
    (requestedPort===0||port===requestedPort),'APPLICATION_RUBY_CUSTOMER_STARTUP_CHANGED');
  return {url:url.href,original:{schema:value.schema,directory:value.directory,
    workspaceIdentity:value.workspaceIdentity,settingsSha256:value.settingsSha256,sourceSha256:value.sourceSha256,
    instanceId:value.instanceId,pid:value.pid}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'ruby-customer',order:116,appendPort:false,
  catalog({common,field}) {
    return [{id:'ruby-customer-workspace',command:'ruby-customer-workspace',title:'Ruby customer commissioning',terminal:false,
      requiredSource:SOURCE+'/server.mjs',
      description:'Review original native or Baserow source, adopt the existing customer job, commission the complete Rails application and operate its installed runtime.',
      fields:[field('workspaceDirectory','Private Ruby runtime','path',true,
        'Select the original initialized Ruby runtime directory. The customer desk keeps its existing environments, operations and received applications.'),
        field('port','Local port','port',false,'0 chooses an available port; the direct command defaults to 8475.'),
        ...common.filter(value=>value.name==='environmentFile')]}];
  },
  validateSettings(type,settings){absolute(settings.workspaceDirectory);},
  async prepare(type,settings,context) {
    const directory=absolute(settings.workspaceDirectory);
    const inputs=[await context.inputPath(directory,'directory',false,true),
      await context.inputPath(join(directory,'ruby-runtime.json'),'file',false,true)];
    const runtime=await inspectMerchantRuntime(absolute(context.runtimeDirectory),{load:false});
    const launch=await launchModel(runtime.sourceRoot);
    await launch.inspectRubyCustomerLaunch({directory,sourceDirectory:join(runtime.sourceRoot,SOURCE)});
    for(const name of FILES)inputs.push(await context.inputPath(join(runtime.sourceRoot,SOURCE,name),'file'));
    return {args:['serve','--directory',directory,'--port',String(settings.port??0),'--startup-json'],inputs,createDirectories:[]};
  },
  resourceKey(type,settings,{hash}){return hash({kind:type.id,directory:settings.workspaceDirectory});},
  runArguments({command,args}){need(command==='ruby-customer-workspace','APPLICATION_RUBY_CUSTOMER_ARGUMENTS_CHANGED');return args;},
  matchRequest(request){return request.command==='ruby-customer-workspace'&&request.args?.[0]==='serve';},
  async verifyLaunch(request){await selected(request);},
  createObserver(request,directory) {
    return observeApplicationStartup(request,directory,line=>{
      if(!line.startsWith('{"schema":"'+SCHEMA+'"'))return null;
      return ()=>startup(request,line);
    },{lineLimit:65536});
  },
};
