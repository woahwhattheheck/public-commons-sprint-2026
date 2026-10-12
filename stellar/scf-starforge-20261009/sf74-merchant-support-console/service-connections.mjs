// MIT. Host configuration for the same native accounting and buyer owners.
import {createHash} from 'node:crypto';
import {resolve,join,isAbsolute} from 'node:path';
import {readPrivateFile} from '../sf93-seller-support-bundle/incident-store.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>Object.assign(new Error(message),{code:'SERVICE_CONNECTION_CHANGED',status:409});
export async function inspectServiceConnections({accountingConfig=null,buyerExpenseConnection=null}={}) {
  const selected={schema:'stellar-forge.support-service-connections.v1',accounting:null,buyer:null};
  const config={accounting:null,buyerExpenses:null};
  for(const [key,path] of [['accounting',accountingConfig],['buyer',buyerExpenseConnection]]) {
    if(path===null)continue;
    if(typeof path!=='string'||!isAbsolute(path))throw fail('Choose the original absolute private connection file.');
    const original=resolve(path),before=await readPrivateFile(original,1024*1024);
    if(key==='accounting')config.accounting=await (await import('../../../stellar-forge/mcp-merchant-operator/accounting.mjs')).readAccountingConfig(original);
    else config.buyerExpenses=await (await import('../../../stellar-forge/mcp-merchant-operator/buyer-expenses.mjs')).readBuyerExpenseConfiguration(original);
    const after=await readPrivateFile(original,1024*1024);
    if(!before.equals(after))throw fail('The connection changed while it was being read. Reopen its current configuration.');
    selected[key]={path:original,sha256:sha(before)};
  }
  return {selected,config};
}
export async function openServiceConnections({accountingConfig=null,buyerExpenseConnection=null,directory,environment=process.env}={}) {
  const {selected,config}=await inspectServiceConnections({accountingConfig,buyerExpenseConnection});
  if(typeof directory!=='string'||!isAbsolute(directory))throw fail('Select the private Service operations directory.');
  config.exportsDirectory=join(resolve(directory),'buyer-exports');
  const accounting=config.accounting?new (await import('../../../stellar-forge/mcp-merchant-operator/accounting.mjs')).MerchantAccounting(config,{environment}):null;
  const buyer=config.buyerExpenses?new (await import('../../../stellar-forge/mcp-merchant-operator/buyer-expenses.mjs')).MerchantBuyerExpenses(config):null;
  let closed;
  return {selected,accounting,buyer,close:()=>closed??=(async()=>{
    const results=await Promise.allSettled([buyer?.close(),accounting?.close()]);
    const errors=results.filter(row=>row.status==='rejected').map(row=>row.reason);
    if(errors.length)throw new AggregateError(errors,'Original Service connections did not finish closing.');
  })()};
}
