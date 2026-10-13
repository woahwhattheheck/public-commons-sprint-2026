// MIT. Metadata only; borrow the original running InboxTask desk lazily.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {taskDeskTools} from '../catalog/task-desk.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'buyer-task-desk',family:'taskDesks',
 title:'Original InboxTask desks',order:1210,catalogOrder:1210,configKey:'taskDesks',
 maxRequestBytes:4194304,
 configuration:{input:'taskDeskConnection',privateExports:true,
  read:async(value,{hostPath})=>(await import('../task-desk-connection.mjs')).readTaskDeskConfiguration(hostPath(value))},
 tools:taskDeskTools,load:()=>import('../task-desk.mjs'),
 create:(module,config,options)=>new module.MerchantTaskDesks(config,options.taskDesks),
 instructions:[{order:1210,prefix:'merchant_task_',text:
  'Use configured original task-desk aliases. Status returns the current instance without its session token. Keep expectedInstanceId, exact task SHA, preview SHA, original native review ID and requestId. Execute/recover/receive return accepted operation metadata; inspect that original request after uncertainty. No tool starts a second desk or native buyer. RPC reads preserve original uncertain outcomes separately from their later complete bytes. File reads retain complete originals and require original SHA/offset on continuation; release temporary reads when finished. Customer delivery uses the same desk’s original native store: create the complete source census, preview, retain the exact returned request and preview hash, prepare once and reconcile that same named request after uncertainty. Download the complete customer/source archive with its package and manifest hashes. Recipient history/uploads and independent customer receiving continue through the original Collections provider.'}],
});
