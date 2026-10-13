/**
 * Use the existing authenticated request, session epoch and durable native
 * mutation journal supplied by the original BIM operator.
 */
export function createSettlementController({request,sessionKey,mutateNote,loadDraft,saveDraft}){
 if(typeof request!=='function'||typeof sessionKey!=='function'||typeof mutateNote!=='function')throw Error('Original request, session and mutation journal are required.');
 const send=(action,body,options={})=>request('/api/settlement/'+action,{method:'POST',body,...options});
 return Object.freeze({
  sessionKey,loadDraft,saveDraft,
  build:async(selection,options={})=>(await send('build',{selection},options)).report,
  source:(input,options={})=>send('source',input,options),
  async file(input,options={}){const value=await send('file',input,{...options,asBlob:true});if(!(value instanceof Blob))throw Error('Original file transport must return the complete Blob.');return value;},
  async receive(file,options={}){
   if(!(file instanceof Blob))throw Error('Choose the complete original source package.');
   const value=await file.text();if(options.signal?.aborted)throw new DOMException('Operation cancelled','AbortError');
   return send('receive',{packet:JSON.parse(value)},options);
  },
  reviews:(input,options={})=>send('reviews',input,options),
  async review(input,options={}){
   const prepared=await send('review-prepare',input,options);
   if(!prepared?.args||!Number.isSafeInteger(prepared.expectedRevision)||prepared.sourceSha256!==input.sourceSha256||prepared.reportSha256!==input.reportSha256)throw Error('Original prepared review basis is incomplete.');
   // mutateNote must retain the complete note.save envelope/request ID before its
   // original /api/command dispatch, and reconcile GET /api/request/:id on retry.
   await mutateNote({method:'note.save',args:prepared.args,expectedRevision:prepared.expectedRevision,workspaceId:prepared.workspaceId},options);
   return{reviews:await send('reviews',{sourceSha256:input.sourceSha256,reportSha256:input.reportSha256},options)};
  }
 });
}
