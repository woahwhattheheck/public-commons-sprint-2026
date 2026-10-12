// MIT. Both managed Ruby desks use the maintained original Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../runtime-workspace/application-provider.mjs';
import { absolute, need, plain, operationId, readJSON, id, sha, exists } from './files.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/distribution/ruby-runtime';
const CORE = ['files.mjs','model.mjs','worker.mjs','engine.rb','application.rb','cli.mjs','application-provider.mjs'];
const WORKSPACE = 'stellar-forge.ruby-runtime-workspace-startup.v1';
const APPLICATION = 'stellar-forge.ruby-rails-application-startup.v1';
function option(args,name,optional=false) {
  need(Array.isArray(args),'APPLICATION_RUBY_ARGUMENTS_CHANGED');
  const positions=args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional && positions.length===0)return undefined;
  need(positions.length===1 && typeof args[positions[0]+1]==='string','APPLICATION_RUBY_ARGUMENTS_CHANGED');
  return args[positions[0]+1];
}
async function sourceModel(sourceRoot) {
  const native=await import(pathToFileURL(join(absolute(sourceRoot),SOURCE,'model.mjs')).href);
  need(typeof native.openRubyRuntime==='function','APPLICATION_RUBY_SOURCE_REQUIRED');
  return native;
}
async function original(request) {
  need(request.command==='ruby-runtime' && ['serve','serve-application'].includes(request.args?.[0]),
    'APPLICATION_RUBY_ARGUMENTS_CHANGED');
  const directory=absolute(option(request.args,'--directory'));
  const native=await sourceModel(join(absolute(request.releaseDirectory),'source'));
  const core=await native.openRubyRuntime({directory});
  return {directory,core};
}
async function checkLaunch(request) {
  const selected=await original(request);
  try {
    if(request.args[0]==='serve')return {directory:selected.directory};
    const applicationId=id(option(request.args,'--id')), key=operationId(option(request.args,'--operation-id'));
    const application=await selected.core.application({id:applicationId});
    const expected=sha(option(request.args,'--application-sha256'));
    const environmentSha=sha(option(request.args,'--environment-selection-sha256'));
    const state=await selected.core.inspect(), environment=state.environments.find(item=>item.id===application.environmentId);
    need(application.selectionSha256===expected && environment?.selectionSha256===environmentSha,
      'APPLICATION_RUBY_SELECTION_CHANGED');
    return {directory:selected.directory,applicationId,operationId:key,applicationSha256:expected,
      environmentSelectionSha256:environmentSha,environmentId:application.environmentId};
  } finally {await selected.core.close();}
}
async function startup(request,line) {
  let value;
  try {value=JSON.parse(line);} catch{return null;}
  if(!plain(value) || ![WORKSPACE,APPLICATION].includes(value.schema))return null;
  const expected=await checkLaunch(request), command=request.args[0];
  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_RUBY_STARTUP_CHANGED');}
  const requestedPort=Number(option(request.args,'--port',true)??(command==='serve'?8474:9292));
  need(url.protocol==='http:' && url.hostname==='127.0.0.1' && !url.username && !url.password &&
    !url.search && /^#token=[a-f0-9]{64}$/.test(url.hash) &&
    Number(url.port)>0 && Number(url.port)<=65535 &&
    (requestedPort===0 || Number(url.port)===requestedPort),'APPLICATION_RUBY_STARTUP_CHANGED');
  if(command==='serve') {
    need(value.schema===WORKSPACE && value.status==='RUBY_RUNTIME_WORKSPACE_READY' &&
      value.directory===expected.directory && url.pathname==='/','APPLICATION_RUBY_STARTUP_CHANGED');
  } else {
    need(value.schema===APPLICATION && value.status==='RUBY_RAILS_APPLICATION_READY' &&
      value.operationId===expected.operationId && value.applicationId===expected.applicationId &&
      value.applicationSha256===expected.applicationSha256 &&
      value.environmentSelectionSha256===expected.environmentSelectionSha256 &&
      value.environmentId===expected.environmentId &&
      value.directory===join(expected.directory,'applications',expected.applicationId,'workspace') &&
      value.http?.status===200 && url.pathname==='/managed-ruby/start','APPLICATION_RUBY_STARTUP_CHANGED');
  }
  return {url:url.href,original:{schema:value.schema,...expected,
    ...(value.http?{http:value.http}:{})}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'ruby-runtime',order:115,appendPort:false,
  catalog({common,field}) {
    const environment=common.filter(item=>item.name==='environmentFile');
    return [
      {id:'ruby-environment-workspace',command:'ruby-runtime',title:'Ruby environments',terminal:false,
        requiredSource:SOURCE+'/workspace/server.mjs',
        description:'Select an exact Ruby interpreter and Bundler lock, install or resume private dependencies, operate received Rails applications and receive complete runtime archives.',
        fields:[field('workspaceDirectory','Private Ruby runtime','path',true,
          'Initialize this directory with ruby-runtime init, then select it here.'),
          field('port','Local port','port',false,'0 chooses an available local port; the direct command defaults to 8474.'),...environment]},
      {id:'ruby-received-application',command:'ruby-runtime',title:'Received Rails application',terminal:false,
        requiredSource:SOURCE+'/application.rb',
        description:'Open the original received dataset, exact mapped target rows, preview and committed history, full source downloads and attachments in its private installed Ruby environment.',
        fields:[field('workspaceDirectory','Private Ruby runtime','path',true),
          field('rubyApplicationId','Registered application ID','text',true),
          field('port','Local port','port',false,'Use a fixed local port; 0 selects the managed Rails default 9292.'),...environment]},
    ];
  },
  validateSettings(type,settings) {
    absolute(settings.workspaceDirectory);
    if(type.id==='ruby-received-application')id(settings.rubyApplicationId);
  },
  async prepare(type,settings,context) {
    const directory=absolute(settings.workspaceDirectory);
    const inputs=[await context.inputPath(directory,'directory',false,true),
      await context.inputPath(join(directory,'ruby-runtime.json'),'file',false,true)];
    const runtime=await inspectMerchantRuntime(absolute(context.runtimeDirectory),{load:false});
    for(const name of CORE)inputs.push(await context.inputPath(join(runtime.sourceRoot,SOURCE,name),'file'));
    const native=await sourceModel(runtime.sourceRoot), core=await native.openRubyRuntime({directory});
    try {
      if(type.id==='ruby-environment-workspace')
        return {args:['serve','--directory',directory,'--port',String(settings.port??0),'--startup-json'],inputs,createDirectories:[]};
      const application=await core.application({id:id(settings.rubyApplicationId)});
      const environment=(await core.inspect()).environments.find(item=>item.id===application.environmentId);
      need(environment?.phase==='READY','APPLICATION_RUBY_INSTALLATION_REQUIRED');
      for(const file of [join(directory,'applications',application.id,'application.json'),
        join(directory,'applications',application.id,'registered.json'),
        join(directory,'environments',environment.id,'selection.json'),
        join(directory,'environments',environment.id,'installation.json')])
        inputs.push(await context.inputPath(file,'file',false,true));
      return {args:['serve-application','--directory',directory,'--id',application.id,
        '--port',String(settings.port||9292),'--application-sha256',application.selectionSha256,
        '--environment-selection-sha256',environment.selectionSha256],inputs,createDirectories:[]};
    }finally{await core.close();}
  },
  resourceKey(type,settings,{hash}) {
    return hash({kind:type.id,directory:settings.workspaceDirectory,
      ...(type.id==='ruby-received-application'?{applicationId:settings.rubyApplicationId}:{})});
  },
  runArguments({command,args,requestId}) {
    need(command==='ruby-runtime','APPLICATION_RUBY_ARGUMENTS_CHANGED');
    return args[0]==='serve-application'?[...args,'--operation-id',operationId(requestId)]:args;
  },
  matchRequest(request) {
    return request.command==='ruby-runtime' && ['serve','serve-application'].includes(request.args?.[0]);
  },
  async verifyLaunch(request) {await checkLaunch(request);},
  createObserver(request,directory) {
    return observeApplicationStartup(request,directory,line=>{
      if(!line.startsWith('{"schema":"'+WORKSPACE+'"') && !line.startsWith('{"schema":"'+APPLICATION+'"'))return null;
      return ()=>startup(request,line);
    },{lineLimit:65536});
  },
};
