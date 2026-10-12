// MIT. Original customer setup and closing through the maintained Applications lifecycle.
import {resolve} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';

const STARTUP='stellar-forge.customer-closing-startup.v1';
function need(ok,message){if(!ok)throw Object.assign(new TypeError(message),{code:'CUSTOMER_CLOSING_APPLICATION_ARGUMENTS',status:400});}
function endpoint(value){
  let url;try{url=new URL(value);}catch{need(false,'Enter the original merchant MCP address.');}
  need(!url.username&&!url.password&&!url.search&&!url.hash&&
    (url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)),
    'Use the original HTTPS or loopback HTTP merchant address without credentials, query or fragment.');
  return url.href;
}
function choice(args,name,fallback){
  const indexes=args.flatMap((value,index)=>value===name?[index]:[]);
  if(!indexes.length)return fallback;
  return indexes.length===1&&typeof args[indexes[0]+1]==='string'?args[indexes[0]+1]:undefined;
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'customer-closing',order:525,
  catalog({common,field}){
    return [{id:'customer-closing',command:'customer-closing',title:'Customer statements',terminal:false,
      requiredSource:'stellar-forge/mcp-merchant-operator/accounting-statement-cycle-server.mjs',
      description:'Maintain customer records, assign original orders, import service captures and close customer periods through the running merchant connection. Resume saved changes, corrections and complete customer deliveries.',
      fields:[
        field('directory','Private customer closing folder','path',true,'Keep the same saved-work folder when reopening or upgrading this application.'),
        field('url','Merchant MCP address','text',true,'The original running merchant connection, such as http://127.0.0.1:8787/mcp.'),
        field('workspace','Accounting workspace alias','text',true,'Use the existing accounting workspace configured on that merchant host.'),
        field('actor','Operator name','text',true,'The operator recorded with customer changes and issued statements.'),
        field('tokenEnv','Access token environment name','text',false,'Defaults to MCP_ACCESS_TOKEN. Supply its value in the private environment file or original host environment.'),
        ...common]}];
  },
  async prepare(type,settings,context){
    const prepared=applicationPreparation(settings,context.inputPath);
    const directory=await prepared.path('directory','directory',true,true);
    need(directory,'Choose the original private customer closing folder.');
    const url=endpoint(settings.url),workspace=settings.workspace,actor=settings.actor?.trim(),tokenEnv=settings.tokenEnv||'MCP_ACCESS_TOKEN';
    need(typeof workspace==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace),'Enter the original accounting workspace alias.');
    need(typeof actor==='string'&&actor&&actor.length<=1000,'Enter the operator recorded on customer changes.');
    need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv),'Enter the existing access-token environment variable name.');
    prepared.args.push('--directory',directory.path,'--url',url,'--workspace',workspace,'--actor',actor,'--token-env',tokenEnv,'--host','127.0.0.1');
    if(!directory.exists)prepared.createDirectories.push(directory.path);
    return {args:prepared.args,inputs:prepared.inputs,createDirectories:prepared.createDirectories};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='customer-closing'&&Array.isArray(request.args);},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+STARTUP+'",'))return null;
      let ready;try{ready=JSON.parse(text);}catch{return null;}
      const args=request.args,selectedDirectory=choice(args,'--directory'),workspace=choice(args,'--workspace'),actor=choice(args,'--actor');
      const requested=Number(choice(args,'--port','4419')),merchantUrl=choice(args,'--url'),tokenEnv=choice(args,'--token-env','MCP_ACCESS_TOKEN');
      if(ready.schema!==STARTUP||ready.status!=='CUSTOMER_CLOSING_READY'||!selectedDirectory||
        ready.directory!==resolve(selectedDirectory)||ready.workspace!==workspace||ready.actor!==actor||
        ready.merchantUrl!==merchantUrl||ready.tokenEnv!==tokenEnv||ready.requestedPort!==requested||
        !Number.isSafeInteger(requested)||requested<0||requested>65535||
        !Number.isSafeInteger(ready.pid)||ready.pid<=0||!Number.isFinite(Date.parse(ready.startedAt)))return null;
      let url;try{url=new URL(ready.url);}catch{return null;}
      if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||
        Number(url.port||80)<1||Number(url.port||80)>65535||requested!==0&&Number(url.port||80)!==requested)return null;
      return {url:url.href,original:{schema:STARTUP,directory:ready.directory,workspace,actor,merchantUrl,tokenEnv,
        requestedPort:requested,pid:ready.pid,startedAt:ready.startedAt}};
    });
  }
};
