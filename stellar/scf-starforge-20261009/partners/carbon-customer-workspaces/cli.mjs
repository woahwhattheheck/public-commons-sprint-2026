#!/usr/bin/env node
// MIT. Configure the existing Merchant host or operate its original tools over JSON lines.
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initializeCarbonCustomerMerchant} from './merchant-setup.mjs';
import {readCarbonCustomerConfiguration} from './configuration.mjs';
import {MerchantCarbonCustomerWorkspaces} from './merchant.mjs';
import {carbonCustomerTools} from './catalog.mjs';
import {need,exact,privateDirectory} from './files.mjs';
export const HELP='Carbon customer-agent operation\n\n'+
'  carbon-customer-agent init --directory NEW_PRIVATE_HOST --connection PRIVATE_CONNECTION.json [--name NAME --release-store ORIGINAL_STORE]\n'+
'  carbon-customer-agent inspect --connection PRIVATE_CONNECTION.json\n'+
'  carbon-customer-agent tools\n'+
'  carbon-customer-agent stdio --connection PRIVATE_CONNECTION.json --exports PRIVATE_EXPORT_DIRECTORY\n\n'+
'stdio reads {id,tool,args} JSON lines, returns one {id,result} or {id,error} line, and retains the same native owners until EOF or a signal. Tool metadata and original domain workflows are in the source-owned Merchant provider.\n';
function parse(args){const command=args[0]||'help',options={};for(let i=1;i<args.length;i++){need(args[i].startsWith('--')&&args[i+1]&&!args[i+1].startsWith('--'),'CARBON_CLI','Use named options with complete values.');const key=args[i].slice(2);need(!Object.hasOwn(options,key),'CARBON_CLI','Supply each option once.');options[key]=args[++i];}return {command,options};}
export async function main(args=process.argv.slice(2)){
 const {command,options}=parse(args);if(['help','--help','-h'].includes(command)){process.stdout.write(HELP);return;}
 const print=v=>process.stdout.write(JSON.stringify(v)+'\n');
 if(command==='tools'){exact(options,[]);print(carbonCustomerTools((name,description,properties,required)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}})));return;}
 if(command==='init'){exact(options,['directory','connection','name','release-store'],['directory','connection']);print(await initializeCarbonCustomerMerchant({directory:options.directory,connection:options.connection,...(options.name?{name:options.name}:{}),...(options['release-store']?{releaseStore:options['release-store']}:{})}));return;}
 exact(options,command==='inspect'?['connection']:['connection','exports'],command==='inspect'?['connection']:['connection','exports']);
 const configuration=await readCarbonCustomerConfiguration(options.connection);
 if(command==='inspect'){print({schema:configuration.schema,workspaces:Object.entries(configuration.workspaces).map(([workspace,v])=>({workspace,kind:v.kind,label:v.label,workspaceId:v.workspaceId,mode:v.mode,files:Object.keys(v.files)})),destinations:Object.keys(configuration.destinations)});return;}
 need(command==='stdio','CARBON_CLI','Choose an original command from --help.');
 const runtime=new MerchantCarbonCustomerWorkspaces({carbonCustomerWorkspaces:configuration,exportsDirectory:await privateDirectory(resolve(options.exports))});
 const input=createInterface({input:process.stdin,crlfDelay:Infinity});let stopping=false;
 const stop=()=>{if(!stopping){stopping=true;runtime.requestClose();input.close();}};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{for await(const line of input){if(!line.trim())continue;let call;try{need(Buffer.byteLength(line)<=8*1024*1024,'CARBON_REQUEST_SIZE','Use a configured file for complete original source intake.');
   call=JSON.parse(line);exact(call,['id','tool','args'],['id','tool']);print({id:call.id,result:await runtime.call(call.tool,call.args??{})});}
  catch(error){print({id:call?.id??null,error:{code:error.code||'CARBON_ERROR',message:error.message,retained:error.retained}});}}}
 finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await runtime.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||'CARBON_ERROR',message:error.message}})+'\n');process.exitCode=1;});
