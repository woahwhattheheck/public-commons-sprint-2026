// MIT. Original Merchant Applications lifecycle over the complete statements workspace.
import {resolve} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {inspectAccountingWorkspaceBinding} from '../../merchant-settlement-accounting/workspace/binding.mjs';
import {inspectBinding} from './store.mjs';
import {need} from './source.mjs';
const option=(args,name)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
async function current(request){
  const binding=await inspectBinding(option(request.args,'--directory'));
  need(binding.workspaceId===option(request.args,'--expected-workspace-id'),
    'STELLARCARBON_WORKSPACE_CHANGED','Reopen the selected original statements workspace.',409);
  const directory=option(request.args,'--accounting-directory');
  let accounting=null;
  if(directory){
    accounting=await inspectAccountingWorkspaceBinding(directory);
    need(accounting.workspaceId===option(request.args,'--expected-accounting-workspace-id')&&
      accounting.sourcesSha256===option(request.args,'--expected-accounting-sources-sha256'),
      'ACCOUNTING_WORKSPACE_CHANGED','Reopen the current original accounting selection.',409);
  }
  return {binding,accounting};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'stellarcarbon-statements',order:535,
  catalog({common,field}){
    return [{id:'stellarcarbon-statements',command:'stellarcarbon-statements',terminal:false,
      requiredSource:'stellar/scf-starforge-20261009/partners/stellarcarbon-statements/cli.mjs',
      title:'Stellarcarbon customer statements',
      description:'Assign original contributions to customers and projects, prepare dated statements, compare source editions, and continue invoices and payment plans in the original Merchant accounting workspace.',
      fields:[
        field('directory','Initialized private statements workspace','path',true,'Open a workspace initialized or received with stellarcarbon-statements.'),
        field('accountingDirectory','Original Merchant accounting workspace','path',false,'Optional original customer, invoice and payment-plan workspace.'),
        ...common]}];
  },
  async prepare(type,settings,context){
    const prepared=applicationPreparation(settings,context.inputPath);
    await prepared.path('directory','directory',false,true);
    const binding=await inspectBinding(settings.directory);
    prepared.args.push('serve','--directory',binding.directory,'--expected-workspace-id',binding.workspaceId);
    let accountingBinding;
    if(settings.accountingDirectory){
      await prepared.path('accountingDirectory','directory',false,true);
      accountingBinding=await inspectAccountingWorkspaceBinding(settings.accountingDirectory);
      prepared.args.push('--accounting-directory',accountingBinding.directory,
        '--expected-accounting-workspace-id',accountingBinding.workspaceId,
        '--expected-accounting-sources-sha256',accountingBinding.sourcesSha256);
    }
    return {args:prepared.args,inputs:prepared.inputs,createDirectories:[],stellarcarbonBinding:binding,
      ...(accountingBinding?{accountingBinding}:{})};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='stellarcarbon-statements'&&request.args?.[0]==='serve';},
  async verifyLaunch(request){await current(request);},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,line=>{
      if(!line.startsWith('{"schema":"stellar-forge.stellarcarbon-startup.v1",'))return null;
      let ready,url;
      try{ready=JSON.parse(line);url=new URL(ready.url);}catch{return null;}
      const selectedDirectory=option(request.args,'--directory'),port=Number(option(request.args,'--port')??0);
      if(!selectedDirectory||ready.directory!==resolve(selectedDirectory)||
        ready.workspaceId!==option(request.args,'--expected-workspace-id')||
        ready.accountingWorkspaceId!==(option(request.args,'--expected-accounting-workspace-id')||null)||
        url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/stellarcarbon/'||
        url.username||url.password||url.search||url.hash||Number(url.port||80)<1||
        (port!==0&&Number(url.port||80)!==port))return null;
      return async()=>{
        const {binding,accounting}=await current(request);
        const response=await fetch(new URL('/api/health',url),{redirect:'error',signal:AbortSignal.timeout(10000)});
        need(response.ok,'STELLARCARBON_STARTUP','The original statements listener did not answer.');
        const health=await response.json();
        need(health.schema===ready.schema&&health.workspaceId===binding.workspaceId&&health.directory===binding.directory,
          'STELLARCARBON_STARTUP_CHANGED','The listener differs from the selected original statements workspace.');
        return {url:url.href,workspaceId:binding.workspaceId,original:{directory:binding.directory,
          accountingWorkspaceId:accounting?.workspaceId||null,accountingSourcesSha256:accounting?.sourcesSha256||null},
          links:accounting?[
            {label:'Original invoices',url:new URL('/receivables/',url).href},
            {label:'Payment plans',url:new URL('/payment-plans/',url).href},
            {label:'Customer accounts',url:new URL('/customer-statements/',url).href},
          ]:[]};
      };
    });
  },
};
