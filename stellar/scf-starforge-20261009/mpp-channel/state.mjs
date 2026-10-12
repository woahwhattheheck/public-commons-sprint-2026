// MIT. One leased original workspace serializes each complete channel operation.
import { AsyncLocalStorage } from 'node:async_hooks';
import { requireValue as need, hash, stable, now } from '../mpp-charge/storage.mjs';
import { streamKey, channelIdentity, amount } from './config.mjs';
import { nativeStore, clientCumulativeKey } from './runtime.mjs';
export const groups=Object.freeze({
  tasks:'channel-tasks', streams:'channel-streams', purchases:'channel-purchases',
  deliveries:'channel-deliveries', settlements:'channel-settlements', receiving:'channel-receiving', settings:'channel-settings',
  funding:'channel-funding',funders:'channel-funders',observations:'channel-observations'
});
const operations=new WeakMap(),operationContext=new AsyncLocalStorage();
export function serialChannel(workspace, terms, operation) {
  let active=operations.get(workspace);
  if(!active) { active=new Map(); operations.set(workspace,active); }
  const key=streamKey(terms),parent=operationContext.getStore();
  // A directly selected same-workspace merchant belongs to its buyer's existing operation.
  if(parent?.active && parent.workspace===workspace && parent.key===key)return Promise.resolve().then(operation);
  const prior=active.get(key) ?? Promise.resolve(),context={workspace,key,active:true};
  const pending=prior.catch(()=>{}).then(()=>operationContext.run(context,operation))
    .finally(()=>{context.active=false;});
  active.set(key,pending);
  pending.finally(()=>{if(active.get(key)===pending)active.delete(key);}).catch(()=>{});
  return pending;
}
export async function drainChannels(workspace) {
  const active=operations.get(workspace); if(active) await Promise.allSettled([...active.values()]);
}
export async function readTask(workspace, taskId) {
  const task=await workspace.read(groups.tasks,taskId);
  need(task?.schema==='stellar-forge.mpp-channel-task-record.v1', 'MPP_CHANNEL_TASK_NOT_FOUND',404);
  need(task.profileId===hash(stable(task.config)), 'MPP_CHANNEL_TASK_PROFILE_CHANGED');
  return task;
}
export async function stream(workspace, terms) {
  const row=await workspace.read(groups.streams,streamKey(terms));
  if(!row) return null;
  need(row.schema==='stellar-forge.mpp-channel-stream.v1' &&
    row.channelIdentity===channelIdentity(terms), 'MPP_CHANNEL_STREAM_IDENTITY_CHANGED');
  return row;
}
export async function ensureStream(workspace, terms) {
  const existing=await stream(workspace,terms); if(existing) return existing;
  const baseline=await nativeStore(workspace,terms).get(clientCumulativeKey(terms));
  // A pre-existing SDK baseline must arrive with its complete original operating history.
  need(!baseline || baseline.amount==='0', 'MPP_CHANNEL_COMPLETE_ORIGINAL_HISTORY_REQUIRED');
  const row={schema:'stellar-forge.mpp-channel-stream.v1', channelIdentity:channelIdentity(terms),
    channel:terms, createdAt:now(), updatedAt:now(), revision:0,
    highestSignedAtomic:'0', activePurchase:null, budgets:{}, state:'OPEN'};
  await workspace.put(groups.streams,streamKey(terms),row); return row;
}
export async function reservePurchase(workspace, task, purchase) {
  const key=streamKey(task.config.channel), current=await ensureStream(workspace,task.config.channel);
  const sdk=await nativeStore(workspace,task.config.channel).get(clientCumulativeKey(task.config.channel));
  need((sdk?.amount ?? '0')===current.highestSignedAtomic, 'MPP_CHANNEL_SIGNED_BASELINE_NEEDS_RECOVERY',409);
  return workspace.update(groups.streams,key,row=>{
    need(row && row.revision===current.revision, 'MPP_CHANNEL_STREAM_CHANGED',409);
    if(row.activePurchase) {
      need(row.activePurchase.purchaseId===purchase.id && row.activePurchase.taskId===task.config.taskId,
        'MPP_CHANNEL_RESUME_ORIGINAL_PURCHASE',409);
      return {op:'noop',result:row.activePurchase};
    }
    need(row.state==='OPEN' && task.status==='AUTHORIZED' && Date.parse(task.config.budget.expiresAt)>Date.now(),
      'MPP_CHANNEL_TASK_AUTHORITY_INACTIVE',409);
    const budget=Object.hasOwn(row.budgets,task.config.taskId)?row.budgets[task.config.taskId]:null;
    need(budget?.profileId===task.profileId, 'MPP_CHANNEL_SELECTED_TASK_AUTHORITY_REQUIRED');
    const unit=BigInt(amount(purchase.challenge.request.amount));
    const spent=BigInt(budget.committedAtomic);
    need(unit<=BigInt(task.config.budget.maximumUnitAtomic) &&
      spent+unit<=BigInt(task.config.budget.maximumAtomic) &&
      budget.purchases < task.config.budget.maximumPurchases, 'MPP_CHANNEL_TASK_BUDGET_EXHAUSTED',409);
    const target=BigInt(row.highestSignedAtomic)+unit;
    amount(target.toString());
    const reservation={purchaseId:purchase.id, taskId:task.config.taskId, profileId:task.profileId,
      amountAtomic:unit.toString(), previousAtomic:row.highestSignedAtomic,
      cumulativeAtomic:target.toString(), reservedAt:now()};
    const next={...row,activePurchase:reservation,revision:row.revision+1,updatedAt:now(),
      budgets:{...row.budgets,[task.config.taskId]:{...budget,
        committedAtomic:(spent+unit).toString(),purchases:budget.purchases+1}}};
    return {op:'set',value:next,result:reservation};
  });
}
export async function markSigned(workspace, terms, reservation) {
  return workspace.update(groups.streams,streamKey(terms),row=>{
    need(row?.activePurchase?.purchaseId===reservation.purchaseId &&
      row.activePurchase.cumulativeAtomic===reservation.cumulativeAtomic, 'MPP_CHANNEL_RESERVATION_CHANGED');
    need([reservation.previousAtomic,reservation.cumulativeAtomic].includes(row.highestSignedAtomic),
      'MPP_CHANNEL_CUMULATIVE_CONFLICT');
    const next={...row,highestSignedAtomic:reservation.cumulativeAtomic,revision:row.revision+1,updatedAt:now()};
    return {op:'set',value:next,result:next};
  });
}
export async function completePurchase(workspace, terms, purchase) {
  return workspace.update(groups.streams,streamKey(terms),row=>{
    if(row?.activePurchase?.purchaseId!==purchase.id) {
      need(BigInt(row?.highestSignedAtomic ?? '0')>=BigInt(purchase.reservation.cumulativeAtomic),
        'MPP_CHANNEL_COMPLETION_BASELINE_CONFLICT');
      return {op:'noop',result:row};
    }
    need(row.activePurchase.purchaseId===purchase.id &&
      row.highestSignedAtomic===purchase.reservation.cumulativeAtomic, 'MPP_CHANNEL_RESERVATION_CHANGED');
    const next={...row,activePurchase:null,revision:row.revision+1,updatedAt:now()};
    return {op:'set',value:next,result:next};
  });
}
export async function snapshot(workspace) {
  return {schema:'stellar-forge.mpp-channel-workspace.v1',
    tasks:await workspace.list(groups.tasks),
    streams:await workspace.list(groups.streams),
    purchases:(await workspace.list(groups.purchases)).map(purchaseView),
    deliveries:(await workspace.list(groups.deliveries)).map(deliveryView),
    settlements:(await workspace.list(groups.settlements)).map(({signedXdr,signature,...row})=>row),
    funding:(await workspace.list(groups.funding)).map(({signedXdr,...row})=>row),
    funderProfiles:await workspace.list(groups.funders),observations:await workspace.list(groups.observations)};
}
function responseView(response) {
  return response?{status:response.status,bytes:response.bytes,sha256:response.sha256,
    contentType:response.headers?.['content-type']}:null;
}
export function purchaseView(row) {
  const {credentialHeader,response,challengeResponse,requestBodyBase64,lastResponse,challengeHistory,...rest}=row;
  return {...rest,response:responseView(response),lastResponse:responseView(lastResponse),
    challengeHistory:(challengeHistory ?? []).map(({credentialHeader,lastResponse,...item})=>
      ({...item,lastResponse:responseView(lastResponse)}))};
}
export function deliveryView(row) {
  const {credentialHeader,response,requestBodyBase64,...rest}=row;
  return {...rest,response:response?{status:response.status,bytes:response.bytes,sha256:response.sha256}:null};
}

export async function rememberObservation(workspace,terms,observation,origin) {
  need(observation.network===terms.network && observation.channel===terms.address,
    'MPP_CHANNEL_OBSERVATION_IDENTITY_CHANGED');
  return workspace.update(groups.observations,streamKey(terms),current=>{
    if(current && current.observation.currentLedger>observation.currentLedger)
      return {op:'noop',result:current};
    const row={schema:'stellar-forge.mpp-channel-observation-record.v1',channel:terms,observation,
      origin,updatedAt:now()};
    return {op:'set',value:row,result:row};
  });
}
