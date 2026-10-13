// MIT. Receive the original issued buyer source and its retained accountant returns.
import {inspectBuyerSource,buyerCanonical,buyerHash} from '../../../scf-starforge-20261009/merchant-settlement-accounting/accountant/buyer-source.mjs';
import {inspectBuyerReturn} from '../../../scf-starforge-20261009/merchant-settlement-accounting/accountant/buyer-return.mjs';
import {pathToFileURL} from 'node:url';

export const EXPENSE_READER_SCHEMA='scf.operations.expense-reader.v1';
const MAX_BYTES=8*1024*1024;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const need=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code});};
const copy=x=>JSON.parse(buyerCanonical(x));
function bytes(value,label) {
  need(typeof value==='string'&&value.length<=Math.ceil(MAX_BYTES/3)*4,
    'EXPENSE_SOURCE_SIZE','Choose an original '+label+' within the grant source limit.');
  const raw=Buffer.from(value,'base64');
  need(raw.length>0&&raw.length<=MAX_BYTES&&raw.toString('base64')===value,
    'EXPENSE_SOURCE_ENCODING','Retain the exact original '+label+' bytes.');
  return raw;
}
export function inspectExpenseSources(input) {
  need(object(input)&&Object.keys(input).every(k=>['sourceBase64','returns'].includes(k)),
    'EXPENSE_INPUT_INVALID','Use the original expense source input.');
  const sourceBytes=bytes(input.sourceBase64,'issued source');
  const inspected=inspectBuyerSource(sourceBytes);
  const returns=input.returns??[];
  need(Array.isArray(returns)&&returns.length<=200,'EXPENSE_RETURN_LIMIT','Retain the complete accepted return set within the original source limit.');
  let total=sourceBytes.length;
  const seen=new Set(),returned=[];
  for(const row of returns) {
    need(object(row)&&Object.keys(row).every(k=>['id','packetBase64'].includes(k))&&
      typeof row.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(row.id)&&!seen.has(row.id),
      'EXPENSE_RETURN_IDENTITY','Each original accepted return needs its unique retained identity.');
    seen.add(row.id);
    const raw=bytes(row.packetBase64,'accountant return');total+=raw.length;
    need(total<=MAX_BYTES,'EXPENSE_SOURCE_SIZE','Select a complete expense source within 8 MiB of native payload.');
    returned.push({id:row.id,...inspectBuyerReturn({packetBytes:raw,buyerSourceBytes:sourceBytes})});
  }
  const close=inspected.document.issued;
  return {
    schema:EXPENSE_READER_SCHEMA,
    source:{...copy(inspected.source),sha256:inspected.sha256,bytes:sourceBytes.length,
      closeSha256:inspected.closeSha256},
    rows:inspected.rows.map(row=>({...copy(row),sourceRowSha256:buyerHash(buyerCanonical(row.original))})),
    labels:copy(close.labels??[]),
    issued:{id:close.id,sequence:close.sequence,createdAt:close.created_at,
      period:copy(close.period),review:copy(close.review),dataContext:close.data_context??'operational'},
    returns:returned
  };
}
async function main() {
  let total=0;const chunks=[];
  for await(const chunk of process.stdin) {
    total+=chunk.length;
    need(total<=12*1024*1024,'EXPENSE_INPUT_SIZE','The selected expense input exceeds the source limit.');
    chunks.push(chunk);
  }
  let input;
  try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{need(false,'EXPENSE_INPUT_JSON','Use complete UTF-8 expense source input.');}
  process.stdout.write(JSON.stringify(inspectExpenseSources(input))+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{
    const code=typeof error.code==='string'&&/^[A-Z0-9_]{1,120}$/.test(error.code)?error.code:'EXPENSE_SOURCE_REJECTED';
    process.stdout.write(JSON.stringify({schema:EXPENSE_READER_SCHEMA,error:{code,message:error.message}})+'\n');
    process.exitCode=2;
  });
}
