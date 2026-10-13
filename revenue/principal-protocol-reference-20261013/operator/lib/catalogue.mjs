// MIT. Exact methods from the complete reference contract API.
import * as fs from 'node:fs';
import {need,keys,integer,address,sha,identity,clone} from './value.mjs';
export const API=JSON.parse(fs.readFileSync(new URL('../CONTRACT_API.json',import.meta.url),'utf8'));
export const API_SHA256=identity(API);
const views=new Set(['is_allowed','is_allowed_for_asset','latest','get_sample','sample_count','first_at_or_after','is_fresh','is_paused','window','preview_deposit','preview_withdraw','balance_of','total_shares','total_underlying','config','find_issue','issue_count','get_issue','balances','maturity_sample','liability','get_admin','reserve_underlying','token_balance','underlying','total_locked_shares','recombination_receipt','effective_reserve']);
export const makeCatalogue=api=>Object.entries(api.contracts).flatMap(([contract,spec])=>Object.entries({...spec.methods,...api.sharedAdminMethods}).map(([method,value])=>({id:contract+'.'+method,label:method.replaceAll('_',' '),contract,method,readOnly:views.has(method),returns:value.returns,fields:Object.entries(value.args).map(([name,type])=>({name,type,required:true,description:type==='i128'?'Exact signed integer base units (7 decimals for token amounts)':type==='u64'?'Exact unsigned integer text':type,default:type==='bool'?false:''})),description:views.has(method)?'Read the selected deployed contract through explicit simulation.':'Prepare an explicit state-changing contract invocation; no authorization is inferred.'})));
export const catalogue=makeCatalogue(API);
export function action(id,api=API){const a=makeCatalogue(api).find(v=>v.id===id);need(a,'UNKNOWN_ACTION',{id});return a;}
export function parameters(id,input,api=API){const a=action(id,api);keys(input,a.fields.map(f=>f.name));const result={};for(const f of a.fields){const v=input[f.name];if(f.type==='u64'||f.type==='i128')result[f.name]=integer(v,f.type);else if(f.type==='Address')result[f.name]=address(v);else if(f.type==='BytesN<32>')result[f.name]=sha(v);else if(f.type==='bool'){need(typeof v==='boolean','BOOLEAN_REQUIRED');result[f.name]=v;}else throw Object.assign(new Error('UNSUPPORTED_ABI_TYPE'),{code:'UNSUPPORTED_ABI_TYPE'});}return result;}
export function invocation(config,id,input,send,api=API){
 const a=action(id,api),p=parameters(id,input,api),c=config.contracts?.[a.contract];
 need(c&&c.id&&c.wasmSha256,'CONTRACT_BINDING_REQUIRED',{contract:a.contract});
 need(config.network?.rpcUrl&&config.network?.passphrase&&config.stellar?.configDirectory&&config.sourceAccount?.alias&&config.sourceAccount?.address,'NATIVE_BINDINGS_REQUIRED');
 const args=['--config-dir',config.stellar.configDirectory,'contract','invoke','--id',address(c.id),'--rpc-url',config.network.rpcUrl,'--network-passphrase',config.network.passphrase,'--source-account',send?config.sourceAccount.alias:address(config.sourceAccount.address),'--send',send?'yes':'no','--',a.method];
 for(const f of a.fields)args.push('--'+f.name+'='+String(p[f.name]));
 return{action:clone(a),parameters:p,argv:args,contract:clone(c),apiSha256:identity(api)};
}
