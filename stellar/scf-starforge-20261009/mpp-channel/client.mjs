// MIT. Agent and application client for the original live channel workspace.
import { connectMppProduct } from '../../../products/mpp-workspace/client.mjs';
import { requireValue as need } from '../mpp-charge/storage.mjs';
import { parseBundle } from './receiving.mjs';
export const actions=Object.freeze([
  'task-template','task-save','task-authorize','task-authority-resume','task-stop',
  'purchase-prepare','purchase-execute','purchase-resume','purchase-refresh','purchase-cancel',
  'merchant-save','merchant-start','merchant-stop','delivery-recover',
  'close-prepare','close-execute','close-resume','close-reconcile','close-cancel',
  'funder-template','funder-save','channel-observe','funding-prepare','funding-execute','funding-resume','funding-reconcile','funding-cancel','collection-prepare','collection-execute','collection-resume','collection-reconcile','collection-cancel',
  'contract-fetch','export','receive'
]);
export class MppChannelClient {
  constructor(product){this.product=product;}
  identity(){return this.product.identity();}
  state(){return this.product.channelState();}
  record(kind,key){return this.product.channelRecord(kind,key);}
  response(purchaseId){return this.product.channelResponse(purchaseId);}
  job(jobId){return this.product.job(jobId);}
  async handover(sha256){
    const result=await this.product.channelHandover(sha256);
    parseBundle(result.bytes.toString('utf8'));return result;
  }
  async invoke(name,input={}, {waitMs=30000}={}){
    need(actions.includes(name),'MPP_CHANNEL_OPERATION_NOT_FOUND',404);
    const started=await this.product.channelAction(name,input);
    if(!started?.id || started.state!=='RUNNING')return{state:'COMPLETE',result:started};
    const job=waitMs?await this.product.waitJob(started.id,{timeoutMs:waitMs}):started;
    if(job.state==='FAILED')throw Object.assign(new Error(job.error),{code:job.error,jobId:job.id});
    return job;
  }
  async runPurchases(document,{waitMs=30000}={}){
    need(document?.schema==='stellar-forge.mpp-channel-work.v1' && Array.isArray(document.purchases) &&
      document.purchases.length>0 && document.purchases.length<=10000,'MPP_CHANNEL_WORK_INPUT_REQUIRED');
    const seen=new Set(),results=[];
    for(const input of document.purchases){
      need(typeof input.purchaseId==='string' && !seen.has(input.purchaseId),'MPP_CHANNEL_WORK_ID_DUPLICATE');
      seen.add(input.purchaseId);
      let original;
      try{original=await this.record('purchases',input.purchaseId);}
      catch(error){if(error.status!==404)throw error;}
      if(!original){
        const prepared=await this.invoke('purchase-prepare',input,{waitMs});
        if(prepared.state!=='COMPLETE')return{state:'RUNNING',results,job:prepared,purchaseId:input.purchaseId};
        original=prepared.result;
      }
      need(original.taskId===input.taskId && original.id===input.purchaseId,'MPP_CHANNEL_ORIGINAL_WORK_CHANGED');
      // Preparation always rechecks the original task/request identity, including completed rows.
      const preparation=await this.invoke('purchase-prepare',input,{waitMs});
      if(preparation.state!=='COMPLETE')return{state:'RUNNING',results,job:preparation,purchaseId:input.purchaseId};
      original=preparation.result;
      if(['CANCELLED','CANCELLING','CHALLENGE_REJECTED'].includes(original.phase))
        return{state:'NEEDS_ORIGINAL_OPERATION',results,purchase:original};
      // COMPLETE also resumes its idempotent journal finalizer.
      const operation=await this.invoke(original.phase==='READY'?'purchase-execute':'purchase-resume',
        {purchaseId:input.purchaseId},{waitMs});
      if(operation.state!=='COMPLETE')return{state:'RUNNING',results,job:operation,purchaseId:input.purchaseId};
      results.push(operation.result);
      if(operation.result.phase!=='COMPLETE')return{state:'NEEDS_ORIGINAL_RESPONSE',results,purchase:operation.result};
    }
    return{schema:'stellar-forge.mpp-channel-work-result.v1',state:'COMPLETE',results};
  }
  close(){return this.product.close();}
}
export async function connectMppChannel(options){return new MppChannelClient(await connectMppProduct(options));}
