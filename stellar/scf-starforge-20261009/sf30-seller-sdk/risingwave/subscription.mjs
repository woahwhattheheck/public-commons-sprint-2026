// MIT. Explicit reviewed native CREATE SUBSCRIPTION with retained request identity.
import { join } from 'node:path';
import { acquireWorkspace } from '../postgres/publisher/files.mjs';
import { fail, exact, qualified, literal, identity, now, privateDirectory, optionalJson, atomicJson, fileInfo, errorValue } from './common.mjs';
import { inspectQuerySource } from './catalogue.mjs';
import { validateNativeColumns } from './declaration.mjs';
function requestId(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))throw fail('RISINGWAVE_REQUEST_ID_REQUIRED');
  return value;
}
export function normalizeRisingWaveRetention(value='1 day'){
  if(typeof value!=='string'||value.length>100)throw fail('RISINGWAVE_RETENTION_INVALID');
  const match=/^\s*([0-9]+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\s*$/i.exec(value);
  if(!match)throw fail('RISINGWAVE_RETENTION_INVALID','Use a positive whole duration such as 1 day or 3600s.');
  const unit=match[2].toLowerCase(),factor=/^s/.test(unit)?1n:/^m/.test(unit)?60n:/^h/.test(unit)?3600n:/^d/.test(unit)?86400n:604800n;
  const seconds=BigInt(match[1])*factor;
  if(seconds<1n||seconds>2147483647n)throw fail('RISINGWAVE_RETENTION_RANGE','Retention must be between one second and 2147483647 seconds.');
  return {text:String(seconds)+'s',seconds:String(seconds),requested:value};
}
export async function inspectRisingWaveSubscription(context,name){
  const query=context.queries[name];if(!query)throw fail('QUERY_NOT_FOUND');
  return context.withConnection(async connection=>{
    const inspected=await inspectQuerySource(connection,query);
    validateNativeColumns(query,inspected.relation.columns);
    return {schema:'stellar-forge.risingwave-subscription-inspection.v1',sourceHash:context.sourceHash,
      query:name,exists:!!inspected.subscription,relation:inspected.relation,subscription:inspected.subscription,observedAt:now()};
  });
}
export async function prepareRisingWaveSubscription(context,name,options={}){
  exact(options,['requestId','retention'],'RISINGWAVE_SUBSCRIPTION_REVIEW_OPTIONS_INVALID');
  const id=requestId(options.requestId),retention=normalizeRisingWaveRetention(options.retention);
  const inspected=await inspectRisingWaveSubscription(context,name),query=context.queries[name];
  if(inspected.subscription&&inspected.subscription.retentionSeconds!==retention.seconds)
    throw fail('RISINGWAVE_SUBSCRIPTION_RETENTION_DIFFERS','The existing subscription has different retention; this operation only creates subscriptions.',
      {requested:retention.seconds,existing:inspected.subscription.retentionSeconds,subscription:query.subscription});
  const review={schema:'stellar-forge.risingwave-subscription-review.v1',requestId:id,query:name,sourceHash:context.sourceHash,
    relation:inspected.relation,subscription:{...query.subscription,existing:inspected.subscription},retention,
    statement:'CREATE SUBSCRIPTION '+qualified(query.subscription)+' FROM '+qualified(query.relation)+
      ' WITH (retention = '+literal(retention.text)+')',preparedAt:now()};
  review.reviewHash=identity(review);return review;
}
export async function createReviewedRisingWaveSubscription(context,review,{requestId:id,directory,signal}={}){
  if(review?.schema!=='stellar-forge.risingwave-subscription-review.v1')throw fail('RISINGWAVE_SUBSCRIPTION_REVIEW_REQUIRED');
  requestId(id);if(id!==review.requestId||review.sourceHash!==context.sourceHash)throw fail('RISINGWAVE_SUBSCRIPTION_REVIEW_CHANGED');
  const hash=review.reviewHash,body={...review};delete body.reviewHash;
  if(hash!==identity(body))throw fail('RISINGWAVE_SUBSCRIPTION_REVIEW_HASH_INVALID');
  const query=context.queries[review.query];if(!query)throw fail('QUERY_NOT_FOUND');
  const retention=normalizeRisingWaveRetention(review.retention.text);
  const statement='CREATE SUBSCRIPTION '+qualified(query.subscription)+' FROM '+qualified(query.relation)+' WITH (retention = '+literal(retention.text)+')';
  if(statement!==review.statement||qualified(review.subscription)!==qualified(query.subscription))throw fail('RISINGWAVE_SUBSCRIPTION_STATEMENT_CHANGED');
  await privateDirectory(directory,true);
  const release=await acquireWorkspace(directory);
  try{
    const retained=await optionalJson(join(directory,'intent.json'));
    if(retained&&(retained.requestId!==id||retained.reviewHash!==hash))throw fail('RISINGWAVE_REQUEST_ID_CONFLICT');
    const saved=await optionalJson(join(directory,'result.json'));
    if(saved){
      if(saved.requestId!==id||saved.reviewHash!==hash)throw fail('RISINGWAVE_REQUEST_ID_CONFLICT');
      return {...saved,files:{intent:await fileInfo(join(directory,'intent.json'),'intent.json'),result:await fileInfo(join(directory,'result.json'),'result.json')}};
    }
    const intent=retained??{schema:'stellar-forge.risingwave-subscription-intent.v1',requestId:id,reviewHash:hash,review,attempts:[],createdAt:now()};
    const check=async connection=>{
      const value=await inspectQuerySource(connection,query);
      if(identity(value.relation)!==identity(review.relation))throw fail('RISINGWAVE_SUBSCRIPTION_RELATION_CHANGED');
      if(review.subscription.existing&&value.subscription?.id!==review.subscription.existing.id)throw fail('RISINGWAVE_SUBSCRIPTION_IDENTITY_CHANGED','The subscription present during review was removed or replaced.');
      if(value.subscription&&value.subscription.retentionSeconds!==retention.seconds)throw fail('RISINGWAVE_SUBSCRIPTION_RETENTION_DIFFERS');
      return value.subscription;
    };
    let subscription,status;
    await atomicJson(join(directory,'intent.json'),intent);
    try{
      await context.withConnection(async connection=>{
        subscription=await check(connection);
        if(subscription){status=intent.attempts.length?'RECONCILED':'EXISTING';return;}
        intent.attempts.push({at:now(),state:'CREATING',statement});
        await atomicJson(join(directory,'intent.json'),intent);
        await connection.query(statement,[],{phase:'create-subscription'});
        subscription=await check(connection);
        if(!subscription)throw fail('RISINGWAVE_SUBSCRIPTION_CREATE_NOT_VISIBLE');
        intent.attempts.at(-1).state='CREATED';status='CREATED';
      },{signal});
    }catch(issue){
      const error=errorValue(issue);
      if(intent.attempts.length)Object.assign(intent.attempts.at(-1),{state:'UNCERTAIN',error,observedAt:now()});
      else intent.attempts.push({at:now(),state:'INSPECTION_FAILED',error});
      await atomicJson(join(directory,'intent.json'),intent);
      if(!signal?.aborted){
        try{subscription=await context.withConnection(check,{signal});if(subscription)status='RECONCILED';}catch{}
      }
      if(!subscription)throw issue;
    }
    intent.completedAt=now();intent.status=status;await atomicJson(join(directory,'intent.json'),intent);
    const result={schema:'stellar-forge.risingwave-subscription-operation.v1',requestId:id,status,reviewHash:hash,
      query:review.query,sourceHash:context.sourceHash,subscription,completedAt:intent.completedAt};
    await atomicJson(join(directory,'result.json'),result);
    return {...result,files:{intent:await fileInfo(join(directory,'intent.json'),'intent.json'),result:await fileInfo(join(directory,'result.json'),'result.json')}};
  }finally{await release();}
}
