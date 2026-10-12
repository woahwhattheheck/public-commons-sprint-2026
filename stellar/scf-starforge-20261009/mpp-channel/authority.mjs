import { dependencyRootFor } from './runtime.mjs';
import { assertOperating } from './receiving.mjs';
// MIT. The operator selects a complete task budget once; each cumulative purchase consumes it.
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { checkOperatorTerminal } from '../sf81-buyer-operator-bridge/bridge.mjs';
import { requireValue as need, now, stable, hash } from '../mpp-charge/storage.mjs';
import { taskConfig, profileKey, streamKey, amount } from './config.mjs';
import { groups, readTask, serialChannel, ensureStream } from './state.mjs';
import { loadChannelNative, observeChannel, outstandingAtomic } from './runtime.mjs';
let terminalBusy=false;
export async function terminalConsent(label, review, confirmation) {
  need(!terminalBusy, 'MPP_CHANNEL_OPERATOR_TERMINAL_BUSY',409);
  terminalBusy=true;
  let file, input, output, terminal;
  try {
    await checkOperatorTerminal(hash(stable(review)).slice(0,32));
    file=await open('/dev/tty','r+');
    need((await file.stat()).isCharacterDevice(), 'MPP_CHANNEL_OPERATOR_TERMINAL_REQUIRED');
    input=file.createReadStream({autoClose:false});
    output=file.createWriteStream({autoClose:false});
    terminal=createInterface({input,output,terminal:true});
    output.write(label+'\n'+JSON.stringify(review,null,2)+'\n');
    const answer=await terminal.question('Type '+confirmation+' to authorize this selected operation: ',
      {signal:AbortSignal.timeout(300000)});
    need(answer===confirmation, 'MPP_CHANNEL_OPERATOR_CONSENT_DECLINED',409);
    return {approvedAt:now(),reviewSha256:hash(stable(review)),method:'controlling-terminal'};
  } finally {
    terminal?.close(); input?.destroy(); output?.destroy();
    await file?.close().catch(()=>{}); terminalBusy=false;
  }
}
export async function saveTask({workspace,config,expectedRevision=0}) {
  const selected=taskConfig(config), profileId=profileKey(selected);
  return serialChannel(workspace,selected.channel,async()=>{
    await assertOperating(workspace,selected.channel);
    const current=await workspace.read(groups.tasks,selected.taskId);
    need((current?.revision ?? 0)===expectedRevision, 'MPP_CHANNEL_TASK_REVISION_CHANGED',409);
    const active=await ensureStream(workspace,selected.channel);
    need(!active.activePurchase || active.activePurchase.taskId!==selected.taskId,
      'MPP_CHANNEL_RESUME_ORIGINAL_PURCHASE',409);
    if(current?.profileId===profileId) return current;
    if(current) {
      need(streamKey(current.config.channel)===streamKey(selected.channel), 'MPP_CHANNEL_NEW_CHANNEL_REQUIRES_NEW_TASK_ID');
      const consumed=Object.hasOwn(active.budgets,selected.taskId)?active.budgets[selected.taskId]:null;
      need(BigInt(selected.budget.maximumAtomic)>=BigInt(consumed?.committedAtomic ?? '0') &&
        selected.budget.maximumPurchases >= (consumed?.purchases ?? 0), 'MPP_CHANNEL_BUDGET_BELOW_COMMITTED_WORK');
    }
    const row={schema:'stellar-forge.mpp-channel-task-record.v1',config:selected,profileId,
      revision:expectedRevision+1,status:'DRAFT',createdAt:current?.createdAt ?? now(),updatedAt:now(),
      history:[...(current?.history ?? []),...(current?[{profileId:current.profileId,revision:current.revision,
        status:current.status,authority:current.authority ?? null,updatedAt:current.updatedAt}]:[])]};
    await workspace.put('profiles',profileId,selected);
    return workspace.update(groups.tasks,selected.taskId,old=>{
      need((old?.revision ?? 0)===expectedRevision, 'MPP_CHANNEL_TASK_REVISION_CHANGED',409);
      return {op:'set',value:row,result:row};
    });
  });
}
export async function authorizeTask({workspace,taskId,expectedRevision}) {
  const selected=await readTask(workspace,taskId);
  return serialChannel(workspace,selected.config.channel,async()=>{
    let task=await readTask(workspace,taskId);
    await assertOperating(workspace,task.config.channel);
    need(task.revision===expectedRevision, 'MPP_CHANNEL_TASK_REVISION_CHANGED',409);
    const current=await ensureStream(workspace,task.config.channel);
    need(!current.activePurchase, 'MPP_CHANNEL_RESUME_ORIGINAL_PURCHASE',409);
    need(current.state==='OPEN' && Date.parse(task.config.budget.expiresAt)>Date.now(),
      'MPP_CHANNEL_TASK_AUTHORITY_INACTIVE',409);
    if(task.status==='AUTHORIZED' && (Object.hasOwn(current.budgets,taskId)?current.budgets[taskId]:null)?.authoritySha256===task.authority?.reviewSha256) return task;
    const native=await loadChannelNative(await dependencyRootFor(workspace,task.config));
    const observation=await observeChannel(native,task.config.channel);
    need(observation.closeEffectiveAtLedger===null, 'MPP_CHANNEL_CLOSING',409);
    const consumed=(Object.hasOwn(current.budgets,taskId)?current.budgets[taskId]:null) ?? {committedAtomic:'0',purchases:0};
    const remaining=BigInt(task.config.budget.maximumAtomic)-BigInt(consumed.committedAtomic);
    need(BigInt(current.highestSignedAtomic)>=BigInt(observation.withdrawnAtomic),
      'MPP_CHANNEL_ORIGINAL_CUMULATIVE_HISTORY_REQUIRED',409);
    const unpaidCommittedAtomic=outstandingAtomic(observation,current.highestSignedAtomic);
    need(remaining>=0n && BigInt(unpaidCommittedAtomic)+remaining<=BigInt(observation.balanceAtomic),
      'MPP_CHANNEL_TASK_EXCEEDS_CURRENT_DEPOSIT',409);
    amount((BigInt(current.highestSignedAtomic)+remaining).toString(),{zero:true});
    const review={schema:'stellar-forge.mpp-channel-task-authority.v1',taskId,profileId:task.profileId,
      operator:task.config.operator,title:task.config.title,usefulTask:task.config.usefulTask,
      source:task.config.source,channel:task.config.channel,request:task.config.request,
      realm:task.config.realm,merchantProfileSha256:task.config.merchantProfileSha256,offerId:task.config.offerId,
      pricedUnit:task.config.pricedUnit,budget:task.config.budget,
      alreadyCommittedAtomic:consumed.committedAtomic,remainingTaskAtomic:remaining.toString(),
      localCumulativeAtomic:current.highestSignedAtomic,unpaidCommittedAtomic,observation};
    const authority=await terminalConsent('Authorize recurring channel work',review,
      'AUTHORIZE '+taskId+' '+task.profileId.slice(0,12));
    // Retain the selected consent before its budget join, so a crash resumes the same authority.
    task={...task,status:'AUTHORIZING',authority:{...authority,review},updatedAt:now()};
    await workspace.put(groups.tasks,taskId,task);
    return completeAuthorization(workspace,task);
  });
}
async function completeAuthorization(workspace,task) {
  const taskId=task.config.taskId, authority=task.authority;
  need(authority?.reviewSha256===hash(stable(authority.review)) &&
    authority.review.profileId===task.profileId, 'MPP_CHANNEL_ORIGINAL_AUTHORITY_REQUIRED');
  await workspace.update(groups.streams,streamKey(task.config.channel),row=>{
    need(row && !row.activePurchase && row.state==='OPEN', 'MPP_CHANNEL_STREAM_CHANGED',409);
    const old=(Object.hasOwn(row.budgets,taskId)?row.budgets[taskId]:null) ?? {committedAtomic:'0',purchases:0};
    need(BigInt(old.committedAtomic)===BigInt(authority.review.alreadyCommittedAtomic),
      'MPP_CHANNEL_TASK_COMMITMENTS_CHANGED',409);
    const budget={...old,profileId:task.profileId,authoritySha256:authority.reviewSha256};
    return {op:'set',value:{...row,budgets:{...row.budgets,[taskId]:budget},
      revision:row.revision+1,updatedAt:now()},result:undefined};
  });
  const row={...task,status:'AUTHORIZED',updatedAt:now()};
  await workspace.put(groups.tasks,taskId,row); return row;
}
export async function resumeTaskAuthority({workspace,taskId}) {
  const task=await readTask(workspace,taskId);
  return serialChannel(workspace,task.config.channel,async()=>{
    const current=await readTask(workspace,taskId);
    await assertOperating(workspace,current.config.channel);
    if(current.status==='AUTHORIZED') return current;
    need(current.status==='AUTHORIZING', 'MPP_CHANNEL_AUTHORITY_RESUME_UNAVAILABLE',409);
    return completeAuthorization(workspace,current);
  });
}
export async function stopTask({workspace,taskId,expectedRevision}) {
  const task=await readTask(workspace,taskId);
  return serialChannel(workspace,task.config.channel,()=>workspace.update(groups.tasks,taskId,current=>{
    need(current?.revision===expectedRevision, 'MPP_CHANNEL_TASK_REVISION_CHANGED',409);
    const stopped={...current,status:'STOPPED',revision:current.revision+1,updatedAt:now()};
    return {op:'set',value:stopped,result:stopped};
  }));
}
