// MIT. Original Merchant Applications lifecycle with a bound independent workspace.
import {resolve} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {inspectBinding} from './store.mjs';
import {need} from './source.mjs';
const option=(args,name)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
async function current(request){
  const binding=await inspectBinding(option(request.args,'--directory'));
  need(binding.workspaceId===option(request.args,'--expected-workspace-id'),'GIVECREDIT_WORKSPACE_CHANGED','Reopen the selected original GiveCredit workspace.',409);
  return binding;
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'cfce-givecredit-statements',order:540,
  catalog({common,field}){
    return [{id:'cfce-givecredit-statements',command:'givecredit-statements',terminal:false,
      requiredSource:'stellar/scf-starforge-20261009/partners/cfce-givecredit-statements/cli.mjs',
      title:'GiveCredit donor and initiative statements',
      description:'Operate original donor payments, pooled provider payouts, carbon contribution associations and complete dated statements with independent editable receiving.',
      fields:[field('directory','Initialized private GiveCredit workspace','path',true,'Open a workspace initialized or received with givecredit-statements.'),...common]}];
  },
  async prepare(type,settings,context){
    const prepared=applicationPreparation(settings,context.inputPath);
    await prepared.path('directory','directory',false,true);
    const binding=await inspectBinding(settings.directory);
    prepared.args.push('serve','--directory',binding.directory,'--expected-workspace-id',binding.workspaceId);
    return {args:prepared.args,inputs:prepared.inputs,createDirectories:[],givecreditBinding:binding};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='givecredit-statements'&&request.args?.[0]==='serve';},
  async verifyLaunch(request){await current(request);},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,line=>{
      if(!line.startsWith('{"schema":"stellar-forge.givecredit-startup.v1",'))return null;
      let ready,url;try{ready=JSON.parse(line);url=new URL(ready.url);}catch{return null;}
      const selectedDirectory=option(request.args,'--directory'),port=Number(option(request.args,'--port')??0);
      if(!selectedDirectory||ready.directory!==resolve(selectedDirectory)||ready.workspaceId!==option(request.args,'--expected-workspace-id')||
        url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/givecredit/'||url.username||url.password||url.search||url.hash||
        Number(url.port||80)<1||(port!==0&&Number(url.port||80)!==port))return null;
      return async()=>{
        const binding=await current(request),response=await fetch(new URL('/api/health',url),{redirect:'error',signal:AbortSignal.timeout(10000)});
        need(response.ok,'GIVECREDIT_STARTUP','The selected GiveCredit listener did not answer.');
        const health=await response.json();
        need(health.schema===ready.schema&&health.workspaceId===binding.workspaceId&&health.directory===binding.directory,
          'GIVECREDIT_STARTUP_CHANGED','The listener differs from the selected original workspace.');
        return {url:url.href,workspaceId:binding.workspaceId,original:{directory:binding.directory},links:[]};
      };
    });
  },
};
